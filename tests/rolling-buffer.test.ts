import { describe, it, expect } from 'vitest';
import { RollingBuffer } from '@/core/tts/rolling-buffer';
import { TranslatedSentence } from '@/core/text-source/types';

describe('RollingBuffer', () => {
  it('adds sentences and returns pending items within horizon ordered nearest first', () => {
    const buffer = new RollingBuffer({ horizonAheadSec: 50, keepBehindSec: 10 });
    const sentences: TranslatedSentence[] = [
      { start: 10, end: 15, uz: 'Gap 1', src_lang: 'en' },
      { start: 2, end: 5, uz: 'Gap 2', src_lang: 'en' },
      { start: 70, end: 75, uz: 'Gap 3', src_lang: 'en' } // > 50s ahead
    ];

    buffer.addSentences(sentences);
    const toSynthesize = buffer.updatePlayhead(0);

    // Should include Gap 2 (at 2s) and Gap 1 (at 10s), but not Gap 3 (at 70s)
    expect(toSynthesize.length).toBe(2);
    expect(toSynthesize[0].uz).toBe('Gap 2'); // nearest first
    expect(toSynthesize[1].uz).toBe('Gap 1');
  });

  it('stores synthesized audio and marks ready', () => {
    const buffer = new RollingBuffer();
    buffer.addSentences([{ start: 0, end: 4, uz: 'Test', src_lang: 'en' }]);

    const id = buffer.makeId(0, 4);
    const audio = new Float32Array(48000); // 2s at 24kHz
    buffer.setAudio(id, audio, 24000);

    const item = buffer.getItem(id);
    expect(item?.status).toBe('READY');
    expect(item?.durationSec).toBe(2);
    expect(item?.audio).toBeDefined();
  });

  it('frees audio older than 10s behind the playhead (prune)', () => {
    const buffer = new RollingBuffer({ horizonAheadSec: 50, keepBehindSec: 10 });
    buffer.addSentences([
      { start: 0, end: 5, uz: 'Old sentence', src_lang: 'en' },
      { start: 20, end: 25, uz: 'Current sentence', src_lang: 'en' }
    ]);

    const oldId = buffer.makeId(0, 5);
    const curId = buffer.makeId(20, 25);

    buffer.setAudio(oldId, new Float32Array(24000), 24000);
    buffer.setAudio(curId, new Float32Array(24000), 24000);

    // Move playhead to 20s (so threshold is 20 - 10 = 10s)
    // Old sentence ends at 5s, which is < 10s -> must be discarded!
    buffer.updatePlayhead(20);

    expect(buffer.getItem(oldId)?.status).toBe('DISCARDED');
    expect(buffer.getItem(oldId)?.audio).toBeUndefined(); // Freed!

    // Current sentence ends at 25s, which is > 10s -> kept!
    expect(buffer.getItem(curId)?.status).toBe('READY');
    expect(buffer.getItem(curId)?.audio).toBeDefined();
  });

  it('re-evaluates horizon on seek', () => {
    const buffer = new RollingBuffer({ horizonAheadSec: 50, keepBehindSec: 10 });
    buffer.addSentences([
      { start: 0, end: 5, uz: 'Start', src_lang: 'en' },
      { start: 100, end: 105, uz: 'At minute 1:40', src_lang: 'en' },
      { start: 110, end: 115, uz: 'At minute 1:50', src_lang: 'en' }
    ]);

    // Seek to 100s
    buffer.onSeek(100);
    const toSynthesize = buffer.updatePlayhead(100);

    expect(toSynthesize.length).toBe(2);
    expect(toSynthesize[0].uz).toBe('At minute 1:40');
    expect(toSynthesize[1].uz).toBe('At minute 1:50');
  });

  it('retrieves ready clips and computes ready duration ahead for seamless seeks', () => {
    const buffer = new RollingBuffer();
    buffer.addSentences([
      { start: 10, end: 15, uz: 'Part 1', src_lang: 'en' },
      { start: 15, end: 20, uz: 'Part 2', src_lang: 'en' }
    ]);

    const id1 = buffer.makeId(10, 15);
    const id2 = buffer.makeId(15, 20);
    buffer.setAudio(id1, new Float32Array(24000), 24000);
    buffer.setAudio(id2, new Float32Array(24000), 24000);

    expect(buffer.hasAudioFor(12)).toBe(true);
    expect(buffer.hasAudioFor(25)).toBe(false);

    const readyClips = buffer.getReadyClipsFrom(10);
    expect(readyClips.length).toBe(2);

    const durationAhead = buffer.computeReadyDurationAhead(10);
    expect(durationAhead).toBe(10); // 10s to 20s = 10s
  });

  it('stops ready duration at the start of any un-synthesized speech', () => {
    const buffer = new RollingBuffer();
    buffer.addSentences([
      { start: 0, end: 5, uz: 'Part 1', src_lang: 'en' },
      { start: 6, end: 12, uz: 'Part 2', src_lang: 'en' }
    ]);

    const id1 = buffer.makeId(0, 5);
    buffer.setAudio(id1, new Float32Array(24000), 24000);
    // Part 2 is still PENDING!

    // Coverage extends through Part 1 (ends at 5s) and up to Part 2 start (6s)
    const durationAhead = buffer.computeReadyDurationAhead(0);
    expect(durationAhead).toBe(6); // 0s to 6s = 6s
  });

  it('reports ready duration for speech-free silence when window is covered', () => {
    const buffer = new RollingBuffer();
    // No sentences added (silence/music window from 100 to 125s)
    buffer.markWindowCovered(100, 125);

    // When playhead is at 100s, it should report 25s ready duration
    expect(buffer.computeReadyDurationAhead(100)).toBe(25);
    expect(buffer.computeReadyDurationAhead(110)).toBe(15);
    expect(buffer.computeReadyDurationAhead(50)).toBe(0); // Not covered
    expect(buffer.isCoveredSilence(110)).toBe(true);
    expect(buffer.isCoveredSilence(50)).toBe(false);

    // If a sentence is added at 115s, 115s is no longer silence
    buffer.addSentences([{ start: 114, end: 116, uz: 'Gap', src_lang: 'en' }]);
    expect(buffer.isCoveredSilence(115)).toBe(false);
  });

  it('stops buffer coverage ahead if there is a gap > 4s between sentences', () => {
    const buffer = new RollingBuffer();
    // Sentence 1 ends at 151s, Sentence 2 starts at 185s (34s gap!)
    buffer.addSentences([
      { start: 146, end: 151, uz: 'Gap 1', src_lang: 'en' },
      { start: 185, end: 187, uz: 'Gap 2', src_lang: 'en' }
    ]);

    const id1 = buffer.makeId(146, 151);
    const id2 = buffer.makeId(185, 187);
    buffer.setAudio(id1, new Float32Array(24000), 24000);
    buffer.setAudio(id2, new Float32Array(24000), 24000);

    // At 146s, buffer should stop at 151s and NOT jump across the 34s gap to 187s!
    expect(buffer.computeReadyDurationAhead(146)).toBe(5); // 151 - 146 = 5s
    // Inside the gap at 175s, ready duration should be 0!
    expect(buffer.computeReadyDurationAhead(175)).toBe(0);
    // And 175s should NOT be recognized as covered silence!
    expect(buffer.isCoveredSilence(175)).toBe(false);
  });
});
