import { expect, it } from 'vitest'
import { browserSummary } from './browserSummary'

it('summarises common browsers and platforms', () => {
  expect(
    browserSummary(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    ),
  ).toBe('Chrome · Windows')
  expect(
    browserSummary(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0 Safari/537.36 Edg/120.0',
    ),
  ).toBe('Edge · Windows')
  expect(
    browserSummary(
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile/15E148 Safari/604.1',
    ),
  ).toBe('Safari · iOS')
  expect(
    browserSummary('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Gecko/20100101 Firefox/121.0'),
  ).toBe('Firefox · macOS')
  expect(
    browserSummary('Mozilla/5.0 (Linux; Android 13; Phone) AppleWebKit/537.36 Chrome/120.0 Mobile'),
  ).toBe('Chrome · Android')
})

it('is null-safe and falls back for unknown agents', () => {
  expect(browserSummary(null)).toBe('—')
  expect(browserSummary('')).toBe('—')
  expect(browserSummary('curl/8.0')).toBe('其他')
})
