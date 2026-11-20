import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { cacheDirProblem, isCacheFile, isTmpFile } from './cache-dir'

const repo = '/work/ccc'

describe('cacheDirProblem', () => {
  it('accepts a directory inside the repo, relative or absolute', () => {
    expect(cacheDirProblem('.prebuild/payloads', repo, repo)).toBeNull()
    expect(cacheDirProblem('/work/ccc/.prebuild/payloads', repo, '/elsewhere')).toBeNull()
    expect(cacheDirProblem('payloads', repo, '/work/ccc/.prebuild')).toBeNull()
  })

  it.each([
    [undefined, 'not set'],
    ['', 'not set'],
    ['   ', 'not set'],
    ['/', 'outside the repo'],
    ['.', 'repo root'],
    [repo, 'repo root'],
    ['/work/ccc/', 'repo root'],
    ['..', 'outside the repo'],
    ['../other/payloads', 'outside the repo'],
    ['/tmp/payloads', 'outside the repo'],
    ['/work/ccc-other/payloads', 'outside the repo'],
    ['.prebuild/../..', 'outside the repo'],
  ])('refuses %j (%s)', (dir, reason) => {
    expect(cacheDirProblem(dir, repo, repo)).toContain(reason)
  })

  it('resolves against the given cwd', () => {
    expect(cacheDirProblem('ccc', repo, '/work')).toContain('repo root')
    expect(cacheDirProblem('x', repo, path.parse(repo).root)).toContain('outside the repo')
  })
})

describe('cache file names', () => {
  const sha = 'da39a3ee5e6b4b0d3255bfef95601890afd80709'

  it('recognises the names loadThrough writes: <sha1>.json and <sha1>.json.<pid>.<12 hex>.tmp', () => {
    expect(isCacheFile(`${sha}.json`)).toBe(true)
    expect(isTmpFile(`${sha}.json.4242.0123456789ab.tmp`)).toBe(true)
  })

  it('matches nothing else, so other files in the dir are never deleted', () => {
    for (const name of ['public-ish.json', 'package.json', 'README.md', '.json', `${sha.toUpperCase()}.json`, `${sha}.json.bak`, `x${sha}.json`]) {
      expect(isCacheFile(name), name).toBe(false)
    }
    for (const name of ['notes.tmp', 'public-ish.json.1.0123456789ab.tmp', `${sha}.json.tmp`, `${sha}.json.1.xyz.tmp`]) {
      expect(isTmpFile(name), name).toBe(false)
    }
  })
})
