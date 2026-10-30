import { readFileSync } from 'fs';
import { join } from 'path';
import { SES_SERVER_VERSION } from './app-version';

describe('SES_SERVER_VERSION', () => {
  it('与 packages/server/package.json 的 version 一致', () => {
    const pkg = JSON.parse(
      readFileSync(join(__dirname, '../../package.json'), 'utf8'),
    ) as { version: string };
    expect(SES_SERVER_VERSION).toBe(pkg.version);
  });
});
