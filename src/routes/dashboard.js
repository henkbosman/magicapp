import express from 'express';
import { getDashboard } from '../services/dashboard-service.js';

export const dashboardReadRouter = express.Router();
dashboardReadRouter.get('/', (req, res) => res.json({ data: getDashboard() }));
