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
  it('recognises cache entries and temp files only', () => {
    expect(isCacheFile('0a1b.json')).toBe(true)
    expect(isTmpFile('0a1b.json.123.abcdef.tmp')).toBe(true)
    expect(isCacheFile('README.md')).toBe(false)
    expect(isTmpFile('notes.txt')).toBe(false)
    expect(isCacheFile('.json')).toBe(false)
  })
})
