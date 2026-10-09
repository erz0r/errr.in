import { spawn } from 'node:child_process';

const target = process.argv[2] ?? process.env.DEPLOY ?? 'momoka:/home/erin/errr.in/site';
const match = target?.match(/^([^:\s]+):(\/[\w./-]+[\w-])$/);
if (!match) {
  console.error('usage: npm run deploy -- host:/absolute/folder');
  process.exit(1);
}
const [, host, dir] = match;

const remote = [
  `rm -rf '${dir}.new' && mkdir -p '${dir}.new'`,
  `tar -C '${dir}.new' -xzf -`,
  `rm -rf '${dir}.old'`,
  `if [ -d '${dir}' ]; then mv '${dir}' '${dir}.old'; fi`,
  `mv '${dir}.new' '${dir}'`,
].join(' && ');

const tar = spawn('tar', ['-C', 'dist', '-czf', '-', '.'], { stdio: ['ignore', 'pipe', 'inherit'] });
const ssh = spawn('ssh', [host, remote], { stdio: ['pipe', 'inherit', 'inherit'] });
tar.stdout.pipe(ssh.stdin);
const done = (child) => new Promise((resolve) => child.on('close', resolve));
const [tarCode, sshCode] = await Promise.all([done(tar), done(ssh)]);
if (tarCode || sshCode) {
  console.error(`deploy failed (tar ${tarCode}, ssh ${sshCode}); the live site is unchanged unless the swap step failed`);
  process.exit(1);
}
console.log(`deployed to ${host}:${dir}`);
