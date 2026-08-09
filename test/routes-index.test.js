'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const router = require('../routes');

test('mounts the mini-program diagnosis endpoints under /diagnose', () => {
  const diagnoseLayer = router.stack.find(layer => layer.name === 'router');

  assert.ok(diagnoseLayer, 'diagnosis router should be mounted');
  assert.match(diagnoseLayer.regexp.source, /diagnose/);

  const routePaths = diagnoseLayer.handle.stack
    .filter(layer => layer.route)
    .map(layer => layer.route.path);

  assert.ok(routePaths.includes('/tasks'));
  assert.ok(routePaths.includes('/tasks/:taskId'));
  assert.ok(routePaths.includes('/tasks/:taskId/cancel'));
});
