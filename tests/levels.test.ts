/**
 * Every built-in level must be solvable by its reference solution.
 */

import { describe, expect, it } from 'vitest';
import { createSession, submit } from '../src/core/engine';
import { LEVELS } from '../src/core/levels';

describe('level solutions', () => {
  for (const level of LEVELS) {
    it(`solves ${level.id}`, () => {
      let session = createSession('level', level);
      for (const line of level.solution) {
        const result = submit(session, line);
        session = result.session;
        if (result.diagnostic) {
          throw new Error(
            `${level.id} solution failed on \`${line}\`: ${result.diagnostic.title}`,
          );
        }
        if (result.meta) {
          throw new Error(`${level.id} solution hit meta on \`${line}\``);
        }
      }
      expect(session.justSolved || session.solved.has(level.id)).toBe(true);
    });
  }

  it('seed programs execute cleanly', () => {
    for (const level of LEVELS) {
      const session = createSession('level', level);
      expect(session.mode).toBe('level');
      expect(session.state.frames.length).toBeGreaterThan(0);
    }
  });
});
