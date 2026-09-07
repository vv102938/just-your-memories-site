const { execSync, spawn } = require('child_process');
const path = require('path');

function freePort(port) {
  if (process.platform === 'win32') {
    execSync(
      `powershell -NoProfile -Command "Get-NetTCPConnection -LocalPort ${port} -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }"`,
      { stdio: 'ignore' }
    );
    return;
  }
  execSync(`lsof -ti:${port} | xargs kill -9 2>/dev/null || true`, { stdio: 'ignore', shell: true });
}

const port = process.env.PORT || 3000;
freePort(port);

setTimeout(() => {
  const serverPath = path.join(__dirname, '..', 'server.js');
  const child = spawn(process.execPath, [serverPath], {
    stdio: 'inherit',
    cwd: path.join(__dirname, '..')
  });
  child.on('exit', (code) => process.exit(code ?? 0));
}, 800);
