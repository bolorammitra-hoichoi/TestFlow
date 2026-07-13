// lib/maestro.js — runs one Maestro flow as a child process, streams its
// stdout line-by-line via onLine, and collects any screenshots it wrote.
//
// Maestro's plain-text stdout already marks each step (e.g. "✅ tapOn ...",
// "❌ assertVisible ..."); for v1 that raw log IS the step record — no JUnit/
// structured-report parsing yet, since the exact CLI output format should be
// confirmed against a real run before code depends on it precisely.
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

function runFlow(flowPath, { serial, screenshotDir, onLine }) {
  return new Promise((resolve) => {
    fs.mkdirSync(screenshotDir, { recursive: true });

    const args = ['test', flowPath];
    if (serial) args.push('--device', serial);

    const child = spawn('maestro', args, { cwd: screenshotDir, shell: process.platform === 'win32' });

    let tail = [];
    const handleChunk = (buf) => {
      // Maestro's CLI output is meant for a terminal: it uses ANSI escape
      // codes (bold/color) and bare \r to redraw progress in place. Neither
      // means anything once dumped into a stored log line, so strip both —
      // otherwise they render as literal garbage/overlap in the browser.
      const clean = buf.toString('utf8')
        .replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '')
        .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '');
      for (const line of clean.split(/\r\n|\r|\n/)) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        tail.push(trimmed);
        if (tail.length > 20) tail.shift();
        onLine(trimmed);
      }
    };
    child.stdout.on('data', handleChunk);
    child.stderr.on('data', handleChunk);

    child.on('close', (code) => {
      const screenshots = fs.existsSync(screenshotDir)
        ? fs.readdirSync(screenshotDir).filter((f) => f.toLowerCase().endsWith('.png'))
        : [];
      resolve({
        status: code === 0 ? 'passed' : 'failed',
        errorMessage: code === 0 ? null : tail.join('\n'),
        screenshotPaths: screenshots.map((f) => path.join(screenshotDir, f)),
      });
    });
  });
}

module.exports = { runFlow };
