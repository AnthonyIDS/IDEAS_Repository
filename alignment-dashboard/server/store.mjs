// Saved dashboards. Each one is a JSON document keyed by a long random ID that
// works as its private link. Two storage options:
//   * GitHub: set GITHUB_TOKEN and GITHUB_REPO (for example AnthonyIDS/IDEAS_Dashboards,
//     ideally a private repository). Free and durable; every save is a commit.
//   * Disk: set DATA_DIR to a Render persistent disk path. Without either, files go to
//     ./data, which a free Render service loses when it restarts.
import { randomBytes } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const MAX_DASHBOARD_BYTES = 1_500_000;
const ID_PATTERN = /^[a-z2-7]{24}$/;
const ALPHABET = 'abcdefghijklmnopqrstuvwxyz234567';

export function newId() {
  return Array.from(randomBytes(24), b => ALPHABET[b % 32]).join('');
}
export const validId = id => typeof id === 'string' && ID_PATTERN.test(id);

class DiskStore {
  constructor(dir, durable) { this.dir = dir; this.kind = 'disk'; this.durable = durable; }
  file(id) { return path.join(this.dir, `${id}.json`); }
  async get(id) {
    try { return JSON.parse(await readFile(this.file(id), 'utf8')); }
    catch (e) { if (e.code === 'ENOENT') return null; throw e; }
  }
  async put(id, doc) {
    await mkdir(this.dir, { recursive: true });
    const tmp = `${this.file(id)}.${process.pid}.tmp`;
    await writeFile(tmp, JSON.stringify(doc));
    await rename(tmp, this.file(id));
  }
}

class GitHubStore {
  constructor({ token, repo, branch, folder, fetchImpl = fetch }) {
    Object.assign(this, { token, repo, branch, folder, fetchImpl });
    this.kind = 'github';
    this.durable = true;
    this.shas = new Map();
    this.queue = new Map();
  }
  url(id) { return `https://api.github.com/repos/${this.repo}/contents/${this.folder}/${id}.json`; }
  headers() {
    return { Authorization: `Bearer ${this.token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'claude-alignment-dashboard' };
  }
  async get(id) {
    const res = await this.fetchImpl(`${this.url(id)}?ref=${encodeURIComponent(this.branch)}`, { headers: this.headers() });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`GitHub storage could not read the dashboard (HTTP ${res.status}).`);
    const body = await res.json();
    this.shas.set(id, body.sha);
    return JSON.parse(Buffer.from(body.content, 'base64').toString('utf8'));
  }
  // Saves run one at a time per dashboard so each commit knows the previous one.
  put(id, doc) {
    const prev = this.queue.get(id) || Promise.resolve();
    const next = prev.catch(() => {}).then(() => this.write(id, doc));
    this.queue.set(id, next);
    return next;
  }
  async write(id, doc, retry = true) {
    if (!this.shas.has(id)) await this.get(id).catch(() => null);
    const body = {
      message: `Save dashboard ${id.slice(0, 6)}`,
      content: Buffer.from(JSON.stringify(doc, null, 1)).toString('base64'),
      branch: this.branch,
      ...(this.shas.get(id) ? { sha: this.shas.get(id) } : {}),
    };
    const res = await this.fetchImpl(this.url(id), { method: 'PUT', headers: { ...this.headers(), 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if ((res.status === 409 || res.status === 422) && retry) {
      this.shas.delete(id);
      return this.write(id, doc, false);
    }
    if (!res.ok) throw new Error(`GitHub storage could not save the dashboard (HTTP ${res.status}). Check GITHUB_TOKEN can write to ${this.repo}.`);
    const out = await res.json();
    this.shas.set(id, out.content?.sha);
  }
}

export function createStore(env = process.env, fetchImpl) {
  if (env.GITHUB_TOKEN && env.GITHUB_REPO) {
    return new GitHubStore({ token: env.GITHUB_TOKEN, repo: env.GITHUB_REPO, branch: env.GITHUB_BRANCH || 'main', folder: env.GITHUB_FOLDER || 'dashboards', fetchImpl });
  }
  const here = path.dirname(fileURLToPath(import.meta.url));
  return new DiskStore(env.DATA_DIR || path.join(here, 'data'), Boolean(env.DATA_DIR));
}
