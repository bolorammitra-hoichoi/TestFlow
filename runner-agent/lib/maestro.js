// lib/maestro.js — runs one Maestro flow as a child process, streams its
// stdout line-by-line via onLine, and collects any screenshots it wrote.
//
// Maestro's plain-text stdout already marks each step (e.g. "✅ tapOn ...",
// "❌ assertVisible ..."); for v1 that raw log IS the step record — no JUnit/
// structured-report parsing yet, since the exact CLI output format should be
// confirmed against a real run before code depends on it precisely.
const { spawn, execFile } = require('child_process');
const fs = require('fs');
const path = require('path');

// Returns { promise, cancel } rather than a bare Promise, so the caller can
// kill the in-flight run (e.g. on a Cancel button click) instead of only
// ever waiting for it to finish on its own.
function runFlow(flowPath, { serial, screenshotDir, onLine }) {
  fs.mkdirSync(screenshotDir, { recursive: true });

  const args = ['test', flowPath];
  if (serial) args.push('--device', serial);

  const isWin = process.platform === 'win32';
  const child = spawn('maestro', args, {
    cwd: screenshotDir,
    shell: isWin,
    // On posix this puts the child in its own process group so `cancel()`
    // can kill the whole tree via a negative pid. Windows instead uses
    // `taskkill /T` below, since `detached` has different (unhelpful)
    // console-spawning semantics there.
    detached: !isWin,
  });

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

  let killed = false;
  function cancel() {
    if (killed) return;
    killed = true;
    if (isWin) {
      // shell:true means child.pid is cmd.exe's PID, not Maestro's actual
      // java process — killing just that leaves Maestro running and still
      // holding the device's session lock (the exact stuck-session problem
      // hit twice already). /T kills the whole process tree.
      execFile('taskkill', ['/pid', String(child.pid), '/T', '/F'], () => {});
    } else {
      try { process.kill(-child.pid, 'SIGKILL'); } catch (e) { try { child.kill('SIGKILL'); } catch (e2) { /* already gone */ } }
    }
  }

  const promise = new Promise((resolve) => {
    child.on('close', (code) => {
      const screenshots = fs.existsSync(screenshotDir)
        ? fs.readdirSync(screenshotDir).filter((f) => f.toLowerCase().endsWith('.png'))
        : [];
      resolve({
        status: killed ? 'cancelled' : (code === 0 ? 'passed' : 'failed'),
        errorMessage: killed ? 'Cancelled.' : (code === 0 ? null : tail.join('\n')),
        screenshotPaths: screenshots.map((f) => path.join(screenshotDir, f)),
      });
    });
  });

  return { promise, cancel };
}

module.exports = { runFlow };
