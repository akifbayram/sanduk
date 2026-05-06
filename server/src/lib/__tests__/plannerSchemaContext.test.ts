import type { Express } from 'express';
import { beforeEach, describe, expect, it } from 'vitest';
import { createTestArea, createTestBin, createTestLocation, createTestUser, joinTestLocation } from '../../__tests__/helpers.js';
import { createApp } from '../../index.js';
import { buildPlannerSchemaContext } from '../aiContext.js';

let app: Express;
beforeEach(() => { app = createApp(); });

describe('buildPlannerSchemaContext', () => {
  it('returns the tags and areas in the location', async () => {
    const { token, user } = await createTestUser(app);
    const loc = await createTestLocation(app, token);
    await createTestArea(app, token, loc.id, 'Garage');
    await createTestArea(app, token, loc.id, 'Kitchen');
    await createTestBin(app, token, loc.id, { name: 'Tools', tags: ['tools', 'metal'] });
    await createTestBin(app, token, loc.id, { name: 'Snacks', tags: ['food'] });

    const schema = await buildPlannerSchemaContext(loc.id, user.id);
    expect(schema.tags.sort()).toEqual(['food', 'metal', 'tools']);
    expect(schema.areas.sort()).toEqual(['Garage', 'Kitchen']);
  });

  it('returns empty arrays when the location is empty', async () => {
    const { token, user } = await createTestUser(app);
    const loc = await createTestLocation(app, token);
    const schema = await buildPlannerSchemaContext(loc.id, user.id);
    expect(schema.tags).toEqual([]);
    expect(schema.areas).toEqual([]);
  });

  it("does not expose User A's private-bin tags to User B", async () => {
    const userA = await createTestUser(app);
    const loc = await createTestLocation(app, userA.token);
    const userB = await createTestUser(app);
    await joinTestLocation(app, userB.token, loc.invite_code);

    await createTestBin(app, userA.token, loc.id, {
      name: 'Secret Stash',
      visibility: 'private',
      tags: ['private-tag-only-a'],
    });
    await createTestBin(app, userA.token, loc.id, {
      name: 'Shared Box',
      visibility: 'location',
      tags: ['shared-tag'],
    });

    const schemaForB = await buildPlannerSchemaContext(loc.id, userB.user.id);
    expect(schemaForB.tags).not.toContain('private-tag-only-a');
    expect(schemaForB.tags).toContain('shared-tag');
  });
});
