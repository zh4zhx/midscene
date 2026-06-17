import type { ExecutionDump } from '@midscene/core';
import { describe, expect, test } from 'vitest';
import { replaceReplayScreenshotsWithUrls } from '../../src/server';

const pngDataUrl = 'data:image/png;base64,aGVsbG8=';
const jpegDataUrl = 'data:image/jpeg;base64,d29ybGQ=';

describe('replaceReplayScreenshotsWithUrls', () => {
  test('moves replay screenshot payloads behind URLs', () => {
    const executionDump = {
      id: 'execution-1',
      logTime: 1,
      name: 'aiAct',
      tasks: [
        {
          taskId: 'task-1',
          type: 'Planning',
          subType: 'Plan',
          status: 'finished',
          param: { prompt: 'click' },
          uiContext: {
            screenshot: { base64: pngDataUrl, capturedAt: 100 },
            shotSize: { width: 120, height: 80 },
            shrunkShotToLogicalRatio: 1,
          },
          recorder: [
            {
              type: 'screenshot',
              ts: 200,
              screenshot: { base64: jpegDataUrl, capturedAt: 200 },
            },
          ],
        },
      ],
    } as unknown as ExecutionDump;

    const result = replaceReplayScreenshotsWithUrls(
      executionDump,
      (imageId) => `/replay-screenshot/request-1/${imageId}`,
    );

    const task = result.dump.tasks[0];
    const contextScreenshot = task.uiContext?.screenshot as {
      base64: string;
      capturedAt: number;
    };
    const recorderScreenshot = task.recorder?.[0].screenshot as {
      base64: string;
      capturedAt: number;
    };

    expect(contextScreenshot.base64).toMatch(
      /^\/replay-screenshot\/request-1\//,
    );
    expect(contextScreenshot.base64).not.toContain('data:image');
    expect(contextScreenshot.capturedAt).toBe(100);
    expect(recorderScreenshot.base64).toMatch(
      /^\/replay-screenshot\/request-1\//,
    );
    expect(recorderScreenshot.base64).not.toContain('data:image');
    expect(recorderScreenshot.capturedAt).toBe(200);
    expect(result.images.size).toBe(2);
    expect([...result.images.values()].map((entry) => entry.mimeType)).toEqual([
      'image/png',
      'image/jpeg',
    ]);
  });
});
