import Joi from 'joi';
import multer from 'multer';

import debugLog from 'api/log/debugLog';
import entities from 'api/entities';
import errorLog from 'api/log/errorLog';
import fs from 'fs';
import path from 'path';
import relationships from 'api/relationships';

import { uploadDocumentsPath } from '../config/paths';
import { validateRequest } from '../utils';
import PDF from './PDF';
import needsAuthorization from '../auth/authMiddleware';
import uploads from './uploads';
import storageConfig from './storageConfig';

const storage = multer.diskStorage(storageConfig);

const deleteFile = filename => new Promise((resolve) => {
  entities.count({ 'file.filename': filename })
  .then((entitiesUsingFile) => {
    if (entitiesUsingFile === 0) {
      fs.unlink(path.join(uploadDocumentsPath, filename), () => {
        resolve();
      });
    } else {
      resolve();
    }
  });
});

export default (app) => {
  const upload = multer({ storage });

  const getDocuments = (sharedId, allLanguages, language) => {
    if (allLanguages) {
      return entities.getAllLanguages(sharedId);
    }

    return entities.get({ sharedId, language });
  };

  const uploadProcess = (req, res, allLanguages = true) => getDocuments(req.body.document, allLanguages, req.language)
  .then((docs) => {
    debugLog.debug(`Upload Process for ${docs[0]._id.toString()}`);
    debugLog.debug(`Original name ${fs.existsSync(req.files[0].originalname)}`);
    debugLog.debug(`File exists ${fs.existsSync(req.files[0].path)}`);
    return entities.saveMultiple(docs.map(doc => ({ ...doc, file: req.files[0], uploaded: true })))
    .then(() => Promise.all(docs
    .filter(doc => doc.file && doc.file.filename)
    .map(doc => deleteFile(doc.file.filename))));
  })
  .then(() => {
    debugLog.debug(`Documents saved as uploaded for: ${req.files[0].originalname}`);
    res.json(req.files[0]);

    const sessionSockets = req.getCurrentSessionSockets();
    sessionSockets.emit('conversionStart', req.body.document);
    debugLog.debug(`Starting conversion of: ${req.files[0].originalname}`);

    const pdf = new PDF(req.files[0]);
    return Promise.all([
      pdf.convert(),
      getDocuments(req.body.document, allLanguages, req.language),
      pdf
    ]);
  })
  .then(([conversion, _docs, pdf]) => {
    debugLog.debug(`Conversion succeeed for: ${req.files[0].originalname}`);

    const thumbnailCreations = [];

    const docs = _docs.map((doc) => {
      debugLog.debug(`Assigning Thumbnail creation for: ${doc._id.toString()}`);
      thumbnailCreations.push(pdf.createThumbnail(doc._id.toString()));

      return {
        ...doc,
        ...conversion
      };
    });

    debugLog.debug('Creating PDF thumbnails');

    return Promise.all(thumbnailCreations)
    .then(() => {
      debugLog.debug('Saving documents');
      return entities.saveMultiple(docs.map(doc => ({ ...doc, file: { ...doc.file, timestamp: Date.now() } }))).then(() => {
        const sessionSockets = req.getCurrentSessionSockets();
        sessionSockets.emit('documentProcessed', req.body.document);
      });
    });
  })
  .catch((err) => {
    errorLog.error(err);
    debugLog.debug(err);

    getDocuments(req.body.document, allLanguages, req.language)
    .then((docs) => {
      entities.saveMultiple(docs.map(doc => ({ ...doc, processed: false })));
    });

    const sessionSockets = req.getCurrentSessionSockets();
    sessionSockets.emit('conversionFailed', req.body.document);
  });

  app.post(
    '/api/upload',

    needsAuthorization(['admin', 'editor']),

    upload.any(),

    validateRequest(Joi.object({
      document: Joi.string().required()
    }).required()),

    (req, res) => uploadProcess(req, res)
  );

  app.post('/api/customisation/upload', needsAuthorization(['admin', 'editor']), upload.any(), (req, res, next) => {
    uploads.save(req.files[0])
    .then((saved) => {
      res.json(saved);
    })
    .catch(next);
  });

  app.get('/api/customisation/upload', needsAuthorization(['admin', 'editor']), (req, res, next) => {
    uploads.get()
    .then((result) => {
      res.json(result);
    })
    .catch(next);
  });

  app.delete(
    '/api/customisation/upload',

    needsAuthorization(['admin', 'editor']),

    validateRequest(Joi.object({
      _id: Joi.string().required()
    }).required(), 'query'),

    (req, res, next) => {
      uploads.delete(req.query._id)
      .then((result) => {
        res.json(result);
      })
      .catch(next);
    }
  );

  app.post(
    '/api/reupload',

    needsAuthorization(['admin', 'editor']),

    upload.any(),

    validateRequest(Joi.object({
      document: Joi.string().required()
    }).required()),

    (req, res, next) => entities.getById(req.body.document, req.language)
    .then((doc) => {
      let deleteReferences = Promise.resolve();
      if (doc.file) {
        deleteReferences = relationships.deleteTextReferences(doc.sharedId, doc.language);
      }
      return Promise.all([doc, deleteReferences]);
    })
    .then(([doc]) => entities.saveMultiple([{ _id: doc._id, toc: [] }]))
    .then(([{ sharedId }]) => entities.get({ sharedId }))
    .then(docs => docs.reduce((addToAllLanguages, doc) => addToAllLanguages && !doc.file, true))
    .then(addToAllLanguages => uploadProcess(req, res, addToAllLanguages))
    .catch(next)
  );
};
