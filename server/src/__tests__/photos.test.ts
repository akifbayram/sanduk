import type { Express } from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../index.js';
import { createTestBin, createTestLocation, createTestUser, TEST_PNG } from './helpers.js';

let app: Express;

beforeEach(() => {
  app = createApp();
});

async function uploadPhoto(app: Express, token: string, binId: string) {
  const res = await request(app)
    .post(`/api/bins/${binId}/photos`)
    .set('Authorization', `Bearer ${token}`)
    .attach('photo', TEST_PNG, 'test.png');
  return res;
}

describe('GET /api/photos', () => {
  it('returns empty for new bin', async () => {
    const { token } = await createTestUser(app);
    const location = await createTestLocation(app, token);
    const bin = await createTestBin(app, token, location.id);

    const res = await request(app)
      .get('/api/photos')
      .query({ bin_id: bin.id })
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.results).toEqual([]);
    expect(res.body.count).toBe(0);
  });

  it('returns uploaded photo', async () => {
    const { token } = await createTestUser(app);
    const location = await createTestLocation(app, token);
    const bin = await createTestBin(app, token, location.id);

    await uploadPhoto(app, token, bin.id);

    const res = await request(app)
      .get('/api/photos')
      .query({ bin_id: bin.id })
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.count).toBe(1);
    expect(res.body.results[0]).toMatchObject({
      bin_id: bin.id,
      filename: 'test.png',
      mime_type: 'image/png',
    });
  });

  it('returns 422 for missing bin_id', async () => {
    const { token } = await createTestUser(app);

    const res = await request(app)
      .get('/api/photos')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(422);
  });

  it('returns 403 for non-member', async () => {
    const { token } = await createTestUser(app);
    const location = await createTestLocation(app, token);
    const bin = await createTestBin(app, token, location.id);

    const { token: otherToken } = await createTestUser(app);

    const res = await request(app)
      .get('/api/photos')
      .query({ bin_id: bin.id })
      .set('Authorization', `Bearer ${otherToken}`);

    expect(res.status).toBe(403);
  });

  it('returns 401 without auth', async () => {
    const res = await request(app).get('/api/photos').query({ bin_id: 'abc' });

    expect(res.status).toBe(401);
  });
});

describe('GET /api/photos/:id/file', () => {
  it('serves the photo file', async () => {
    const { token } = await createTestUser(app);
    const location = await createTestLocation(app, token);
    const bin = await createTestBin(app, token, location.id);

    const uploadRes = await uploadPhoto(app, token, bin.id);
    const photoId = uploadRes.body.id;

    const res = await request(app)
      .get(`/api/photos/${photoId}/file`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('image/png');
  });

  it('returns 404 for non-existent photo', async () => {
    const { token } = await createTestUser(app);

    const res = await request(app)
      .get('/api/photos/nonexistent/file')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(404);
  });
});

describe('DELETE /api/photos/:id', () => {
  it('deletes a photo', async () => {
    const { token } = await createTestUser(app);
    const location = await createTestLocation(app, token);
    const bin = await createTestBin(app, token, location.id);

    const uploadRes = await uploadPhoto(app, token, bin.id);
    const photoId = uploadRes.body.id;

    const res = await request(app)
      .delete(`/api/photos/${photoId}`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.message).toBe('Photo deleted');
  });

  it('returns 404 for non-existent photo', async () => {
    const { token } = await createTestUser(app);

    const res = await request(app)
      .delete('/api/photos/nonexistent')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(404);
  });

  it('photo is gone after delete', async () => {
    const { token } = await createTestUser(app);
    const location = await createTestLocation(app, token);
    const bin = await createTestBin(app, token, location.id);

    const uploadRes = await uploadPhoto(app, token, bin.id);
    const photoId = uploadRes.body.id;

    await request(app)
      .delete(`/api/photos/${photoId}`)
      .set('Authorization', `Bearer ${token}`);

    const afterRes = await request(app)
      .get('/api/photos')
      .query({ bin_id: bin.id })
      .set('Authorization', `Bearer ${token}`);

    expect(afterRes.status).toBe(200);
    expect(afterRes.body.count).toBe(0);
    expect(afterRes.body.results).toEqual([]);
  });
});
