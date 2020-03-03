import { tcServer } from 'api/config/topicClassification';
import entities from 'api/entities';
import { search } from 'api/search';
import db from 'api/utils/testing_db';
import JSONRequest from 'shared/JSONRequest';
import { TaskProvider } from '../../tasks/tasks';
import { SyncArgs, syncEntity } from '../sync';
import fixtures, { e1 } from './fixtures';

function fakeTopicClassification(url: string, data: any, _headers: any) {
  if (url === `${tcServer}/classification_sample?model=undefined-topmovies`) {
    expect(data).toEqual({
      refresh_predictions: true,
      samples: [{ seq: 'title1', sharedId: 'e1' }],
    });
    return {
      status: 200,
      json: {
        samples: [
          {
            sharedId: 'e1',
            predicted_labels: [
              { topic: '1.1', quality: 0.4 },
              { topic: '2.2', quality: 0.7 },
            ],
            model_version: 123,
          },
        ],
      },
    };
  }
  return { status: 404 };
}

describe('templates utils', () => {
  beforeEach(async () => {
    await db.clearAllAndLoad(fixtures);
    spyOn(search, 'indexEntities').and.returnValue(Promise.resolve());
    spyOn(JSONRequest, 'put').and.callFake(fakeTopicClassification);
  });
  afterAll(async () => {
    await db.disconnect();
  });

  describe('sync one', () => {
    it('add suggestions to single entity', async () => {
      const e = await entities.getById(e1);
      expect(await syncEntity(e!, { mode: 'onlynew' })).toBe(true);
      expect(e!.suggestedMetadata!.movies).toEqual([
        {
          label: 'spiderman',
          suggestion_confidence: 0.7,
          suggestion_model: 123,
          value: '2.2',
        },
        {
          label: 'groundhog day',
          suggestion_confidence: 0.4,
          suggestion_model: 123,
          value: '1.1',
        },
      ]);
    });
  });
  describe('sync all', () => {
    it('run sync task', async () => {
      const t = TaskProvider.getOrCreate('test', 'TopicClassificationSync');
      t.start({ noDryRun: true, mode: 'onlynew' } as SyncArgs);
      await t.wait();
      expect(t.status).toEqual(
        expect.objectContaining({
          result: { index: 1, seen: 1 },
          state: 'done',
        })
      );
      const e = await entities.getById(e1);
      expect(e!.suggestedMetadata!.movies).toEqual([
        {
          label: 'spiderman',
          suggestion_confidence: 0.7,
          suggestion_model: 123,
          value: '2.2',
        },
        {
          label: 'groundhog day',
          suggestion_confidence: 0.4,
          suggestion_model: 123,
          value: '1.1',
        },
      ]);
    });
  });
});
