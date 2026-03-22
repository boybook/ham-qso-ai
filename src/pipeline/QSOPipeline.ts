import EventEmitter from 'eventemitter3';
import type { AudioChunk, RadioMetadata } from '../types/audio.js';
import type { QSOPipelineConfig } from '../types/config.js';
import type { QSODraft } from '../types/qso.js';
import type { ProcessedTurn, Turn } from '../types/turn.js';
import { createLogger, type ILogger } from '../utils/logger.js';
import { EnergyVAD } from '../segmentation/EnergyVAD.js';
import { AudioIngestionManager } from '../ingestion/AudioIngestionManager.js';
import { ASRManager } from '../asr/ASRManager.js';
import { RuleBasedFeatureExtractor, type IFeatureExtractor } from '../extraction/FeatureExtractor.js';
import { QSOSessionEngine } from '../session/QSOSessionEngine.js';
import { getFrequencyChangeThreshold } from '../session/QSOStateMachine.js';
import { QSODraftEmitter } from '../output/QSODraftEmitter.js';

/**
 * Events emitted by the QSO pipeline.
 */
export interface QSOPipelineEvents {
  'qso:draft': (draft: QSODraft) => void;
  'qso:updated': (draft: QSODraft) => void;
  'qso:ready': (draft: QSODraft) => void;
  'qso:closed': (draft: QSODraft) => void;
  'turn:transcribed': (turn: ProcessedTurn) => void;
  'error': (error: Error) => void;
}

/**
 * Main QSO pipeline.
 *
 * Audio → [Segmenter] → [ASR] → [Feature Extractor] → [Session Engine] → Draft
 *
 * Each candidate maintains its own field pools. The pipeline maps
 * candidate IDs to draft IDs for multi-QSO tracking.
 */
export class QSOPipeline extends EventEmitter<QSOPipelineEvents> {
  private readonly config: QSOPipelineConfig;
  private readonly logger: ILogger;
  private readonly ingestion: AudioIngestionManager;
  private readonly asrManager: ASRManager;
  private readonly extractor: IFeatureExtractor;
  private readonly sessionEngine: QSOSessionEngine;
  private readonly draftEmitter: QSODraftEmitter;
  private readonly candidateDraftMap: Map<string, string> = new Map();
  private lastFrequency: number = 0;
  private lastMode: string = '';
  private started: boolean = false;

  constructor(config: QSOPipelineConfig) {
    super();
    this.config = config;
    this.logger = createLogger('QSOPipeline', config.logger);

    const vad = config.segmenter ?? new EnergyVAD({
      energyThreshold: config.vad?.energyThreshold,
      minSpeechDuration: config.vad?.minSpeechDuration,
      silenceTimeout: config.vad?.silenceTimeout,
    });

    this.asrManager = new ASRManager({
      primary: config.asr.primary,
      fallback: config.asr.fallback,
      logger: config.logger,
    });

    this.extractor = config.extractor ?? new RuleBasedFeatureExtractor();

    this.sessionEngine = new QSOSessionEngine({
      myCallsign: config.session.myCallsign,
      silenceTimeout: config.silenceTimeout ?? 15000,
      holdTimeout: config.holdTimeout ?? 120000,
    });

    this.draftEmitter = new QSODraftEmitter();
    this.ingestion = new AudioIngestionManager(vad);

    // Wire layers
    this.ingestion.onTurn(turn => this.handleTurn(turn));
    this.sessionEngine.on('sessionStarted', id => this.handleSessionStarted(id));
    this.sessionEngine.on('sessionClosed', id => this.handleSessionClosed(id));
  }

  async start(): Promise<void> {
    if (this.started) return;
    await this.asrManager.initialize();
    this.sessionEngine.start();
    this.started = true;
    this.logger.info('pipeline started');
  }

  async stop(): Promise<void> {
    if (!this.started) return;
    this.ingestion.flush();
    this.sessionEngine.stop();
    this.started = false;
    this.logger.info('pipeline stopped');
  }

  async dispose(): Promise<void> {
    await this.stop();
    await this.asrManager.dispose();
    this.logger.info('pipeline disposed');
  }

  pushAudio(chunk: AudioChunk): void {
    if (!this.started) return;
    this.ingestion.pushAudio(chunk);
  }

  pushMetadata(metadata: RadioMetadata): void {
    this.ingestion.pushMetadata(metadata);
    this.sessionEngine.updateMetadata(metadata.frequency, metadata.mode);

    // Mode-aware frequency change detection
    if (this.lastFrequency > 0 && metadata.frequency !== this.lastFrequency) {
      const threshold = getFrequencyChangeThreshold(this.lastMode || metadata.mode);
      const diff = Math.abs(metadata.frequency - this.lastFrequency);
      if (diff > threshold) {
        this.sessionEngine.onFrequencyChanged(metadata.frequency);
      }
    }
    this.lastFrequency = metadata.frequency;
    this.lastMode = metadata.mode;
  }

  getActiveDrafts(): QSODraft[] {
    return this.draftEmitter.getActive();
  }

  confirmDraft(draftId: string): QSODraft | null {
    const draft = this.draftEmitter.confirm(draftId);
    if (draft) this.emit('qso:closed', draft);
    return draft;
  }

  discardDraft(draftId: string): void {
    this.draftEmitter.discard(draftId);
  }

  private async handleTurn(turn: Turn): Promise<void> {
    try {
      const ctx = this.sessionEngine.getContext();
      const knownCallsigns = ctx.detectedCallsigns.map(c => c.callsign);
      const prompt = [this.config.session.myCallsign, ...knownCallsigns].join(' ');

      const asrResult = await this.asrManager.transcribe(
        turn.audio, turn.sampleRate,
        { language: this.config.session.languageHint, prompt },
      );

      if (!asrResult || !asrResult.text.trim()) return;

      const features = await this.extractor.extract(asrResult.text, turn.id, {
        knownCallsigns,
        myCallsign: this.config.session.myCallsign,
        frequency: this.lastFrequency,
        language: this.config.session.languageHint,
      });

      const processedTurn: ProcessedTurn = {
        ...turn,
        text: asrResult.text,
        asrConfidence: asrResult.confidence,
        asrProvider: asrResult.provider,
        features,
        speaker: turn.direction === 'tx' ? this.config.session.myCallsign : undefined,
        speakerConfidence: turn.direction === 'tx' ? 1.0 : undefined,
      };

      // Session engine handles routing to the correct candidate
      this.sessionEngine.processTurn(processedTurn);
      this.emit('turn:transcribed', processedTurn);
      this.updatePrimaryDraft();
    } catch (err) {
      this.logger.error('turn processing failed', err);
      this.emit('error', err instanceof Error ? err : new Error(String(err)));
    }
  }

  private handleSessionStarted(candidateId: string): void {
    const candidate = this.sessionEngine.getPrimaryCandidate();
    if (!candidate) return;

    const fields = candidate.resolveFields();
    const turns = candidate.getTurns();
    const trace = candidate.getTrace();
    const draft = this.draftEmitter.create(fields, turns, trace);
    this.candidateDraftMap.set(candidateId, draft.id);
    this.emit('qso:draft', draft);
    this.logger.info('new QSO draft created', { draftId: draft.id, candidateId });
  }

  private handleSessionClosed(candidateId: string): void {
    const draftId = this.candidateDraftMap.get(candidateId);
    if (!draftId) return;

    const draft = this.updateDraftForCandidate(candidateId);
    if (draft) {
      this.emit('qso:closed', draft);
      this.logger.info('QSO session closed', {
        draftId: draft.id, status: draft.status,
        callsign: draft.fields.theirCallsign.value,
      });
    }

    this.candidateDraftMap.delete(candidateId);
    this.sessionEngine.reset();
  }

  private updatePrimaryDraft(): void {
    const primary = this.sessionEngine.getPrimaryCandidate();
    if (!primary) return;
    this.updateDraftForCandidate(primary.id);
  }

  private updateDraftForCandidate(candidateId: string): QSODraft | null {
    const draftId = this.candidateDraftMap.get(candidateId);
    if (!draftId) return null;

    const candidate = this.sessionEngine.getPrimaryCandidate();
    if (!candidate || candidate.id !== candidateId) return null;

    const fields = candidate.resolveFields();
    const turns = candidate.getTurns();
    const trace = candidate.getTrace();
    const previousDraft = this.draftEmitter.get(draftId);
    const previousStatus = previousDraft?.status;

    const draft = this.draftEmitter.update(draftId, fields, turns, trace);
    if (draft) {
      this.emit('qso:updated', draft);
      if (previousStatus === 'draft' && draft.status === 'ready') {
        this.emit('qso:ready', draft);
        this.logger.info('QSO draft ready', {
          draftId: draft.id, callsign: draft.fields.theirCallsign.value,
        });
      }
    }
    return draft;
  }
}
