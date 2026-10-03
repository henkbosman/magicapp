import express from 'express';
import { listDiscoveryMarks, setDiscoveryMark } from '../services/discovery-mark-service.js';

export const discoveryMarksReadRouter = express.Router();
export const discoveryMarksWriteRouter = express.Router();

discoveryMarksReadRouter.get('/', (req, res) => {
  res.json({ data: listDiscoveryMarks() });
});

discoveryMarksWriteRouter.post('/', (req, res) => {
  res.json({ data: setDiscoveryMark(req.body) });
});
