import {
  addDays,
  ageOn,
  daysInMonth,
  daysUntilBirthday,
  formatInTz,
  formatMonthDay,
  weekdayCN,
} from './date'

it('does calendar math', () => {
  expect(addDays('2026-12-31', 1)).toBe('2027-01-01')
  expect(daysInMonth('2027-02')).toBe(28)
  expect(daysInMonth('2028-02')).toBe(29)
  expect(weekdayCN('2026-11-01')).toBe('星期日')
  expect(formatMonthDay('2026-11-02')).toBe('11月2日')
})

it('counts days until the next birthday, treating Feb 29 as Feb 28 in common years', () => {
  expect(daysUntilBirthday('2017-11-03', '2026-11-01')).toBe(2)
  expect(daysUntilBirthday('2017-11-01', '2026-11-01')).toBe(0)
  expect(daysUntilBirthday('2017-10-31', '2026-11-01')).toBe(364)
  expect(daysUntilBirthday('2016-02-29', '2027-02-27')).toBe(1)
  expect(daysUntilBirthday('2016-02-29', '2028-02-27')).toBe(2)
  expect(ageOn('2016-02-29', '2027-02-28')).toBe(11)
  expect(ageOn('2017-11-03', '2026-11-02')).toBe(8)
})

it('formats instants in the school time zone', () => {
  expect(formatInTz('2026-11-01T16:30:00Z', 'Asia/Shanghai')).toBe('2026-11-02 00:30')
})
