import { expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import ChatInput from '../ChatInput'

it('retains a draft when transport refuses it and clears it only when sent', () => {
  const send = vi.fn().mockReturnValueOnce(false).mockReturnValueOnce(true)
  render(<ChatInput onSend={send} />)
  const input = screen.getByRole('textbox')
  fireEvent.change(input, { target: { value: 'Hello table' } })
  fireEvent.click(screen.getByRole('button', { name: '发送' }))
  expect(input).toHaveValue('Hello table')
  fireEvent.click(screen.getByRole('button', { name: '发送' }))
  expect(input).toHaveValue('')
})
