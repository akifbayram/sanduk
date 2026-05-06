import type { Express } from 'express';
import { beforeEach, describe, expect, it } from 'vitest';
import { createTestArea, createTestBin, createTestLocation, createTestUser } from '../../__tests__/helpers.js';
import { createApp } from '../../index.js';
import { buildPlannerSchemaContext } from '../aiContext.js';

let app: Express;
beforeEach(() => { app = createApp(); });

describe('buildPlannerSchemaContext', () => {
  it('returns the tags and areas in the location', async () => {
    const { token } = await createTestUser(app);
    const loc = await createTestLocation(app, token);
    await createTestArea(app, token, loc.id, 'Garage');
    await createTestArea(app, token, loc.id, 'Kitchen');
    await createTestBin(app, token, loc.id, { name: 'Tools', tags: ['tools', 'metal'] });
    await createTestBin(app, token, loc.id, { name: 'Snacks', tags: ['food'] });

    const schema = await buildPlannerSchemaContext(loc.id);
    expect(schema.tags.sort()).toEqual(['food', 'metal', 'tools']);
    expect(schema.areas.sort()).toEqual(['Garage', 'Kitchen']);
  });

  it('returns empty arrays when the location is empty', async () => {
    const { token } = await createTestUser(app);
    const loc = await createTestLocation(app, token);
    const schema = await buildPlannerSchemaContext(loc.id);
    expect(schema.tags).toEqual([]);
    expect(schema.areas).toEqual([]);
  });
});
