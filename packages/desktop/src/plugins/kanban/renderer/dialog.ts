export interface DialogOptions {
  title: string
  message?: string
  /** Shows a text field; the dialog then resolves with its value. */
  input?: { label: string; value: string; type?: 'text' | 'number'; min?: number }
  confirmText: string
  cancelText: string
  danger?: boolean
}

let openCount = 0

/**
 * Modal prompt/confirmation in the app's look. Resolves with the input value
 * (or '' without input) on confirm and null on cancel (Esc, the cancel button
 * or a click outside). Focus returns to the previously focused element.
 */
export const openDialog = (options: DialogOptions): Promise<string | null> => {
  const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
  const id = `kanban-dialog-${++openCount}`

  const overlay = document.createElement('div')
  overlay.className = 'kanban-dialog-overlay'
  const dialog = document.createElement('div')
  dialog.className = 'kanban-dialog'
  dialog.setAttribute('role', options.danger ? 'alertdialog' : 'dialog')
  dialog.setAttribute('aria-modal', 'true')
  dialog.setAttribute('aria-labelledby', `${id}-title`)
  overlay.append(dialog)

  const title = document.createElement('h2')
  title.id = `${id}-title`
  title.className = 'kanban-dialog-title'
  title.textContent = options.title
  dialog.append(title)

  if (options.message) {
    const message = document.createElement('p')
    message.id = `${id}-message`
    message.className = 'kanban-dialog-message'
    message.textContent = options.message
    dialog.setAttribute('aria-describedby', message.id)
    dialog.append(message)
  }

  let input: HTMLInputElement | null = null
  if (options.input) {
    const label = document.createElement('label')
    label.className = 'kanban-dialog-label'
    label.textContent = options.input.label
    input = document.createElement('input')
    input.className = 'kanban-dialog-input'
    input.type = options.input.type ?? 'text'
    if (options.input.min !== undefined) input.min = String(options.input.min)
    input.value = options.input.value
    label.append(input)
    dialog.append(label)
  }

  const buttons = document.createElement('div')
  buttons.className = 'kanban-dialog-buttons'
  const cancel = document.createElement('button')
  cancel.type = 'button'
  cancel.className = 'kanban-button'
  cancel.textContent = options.cancelText
  const confirm = document.createElement('button')
  confirm.type = 'button'
  confirm.className = options.danger ? 'kanban-button is-danger' : 'kanban-button is-primary'
  confirm.textContent = options.confirmText
  buttons.append(cancel, confirm)
  dialog.append(buttons)

  document.body.append(overlay)
  const focusable = [input, cancel, confirm].filter((element): element is HTMLInputElement | HTMLButtonElement => !!element)
  if (input) {
    input.focus()
    input.select()
  } else {
    ;(options.danger ? cancel : confirm).focus()
  }

  return new Promise((resolve) => {
    const close = (value: string | null): void => {
      overlay.remove()
      previousFocus?.focus()
      resolve(value)
    }
    confirm.addEventListener('click', () => close(input ? input.value : ''))
    cancel.addEventListener('click', () => close(null))
    overlay.addEventListener('mousedown', (event) => {
      if (event.target === overlay) close(null)
    })
    overlay.addEventListener('keydown', (event) => {
      event.stopPropagation()
      if (event.key === 'Escape') {
        event.preventDefault()
        close(null)
      } else if (event.key === 'Enter' && event.target === input && !event.isComposing) {
        event.preventDefault()
        close(input ? input.value : '')
      } else if (event.key === 'Tab') {
        // Keep focus inside the dialog.
        const index = focusable.indexOf(document.activeElement as HTMLInputElement | HTMLButtonElement)
        const next = (index + (event.shiftKey ? -1 : 1) + focusable.length) % focusable.length
        event.preventDefault()
        focusable[next].focus()
      }
    })
  })
}
