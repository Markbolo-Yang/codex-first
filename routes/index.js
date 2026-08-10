'use strict';

const express = require('express');
const diagnoseRouter = require('./diagnose');
const resumeParserRouter = require('./resume-parser');

const router = express.Router();

// Keep feature routers behind the single /api mount in app.js. Existing payment
// and quota behavior remains owned by the diagnosis service and worker.
router.use('/diagnose', diagnoseRouter);
router.use('/resume', resumeParserRouter);

module.exports = router;
