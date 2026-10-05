import { describe, expect, it } from 'vitest'
import { MobileFsError } from '../src/main/fs/backend'
import { androidString, describeError } from '../src/main/dialogs'
import { UnsupportedEncodingError } from '../src/main/markdownFile'

describe('Android messages', () => {
  it('speaks Portuguese for pt and falls back to English for untranslated locales', () => {
    expect(androidString('pt', 'cannotSave')).toBe('Não foi possível salvar o arquivo')
    expect(androidString('de', 'cannotSave')).toBe('Cannot save file')
    expect(androidString('pt', 'deletePermanently', 'nota.md')).toBe(
      'Excluir "nota.md" permanentemente? O Android não tem lixeira.'
    )
  })

  it('describes file errors by code, never with the virtual path', () => {
    const revoked = new MobileFsError('PERMISSION_DENIED', '/vault/5d3978c6/Notas/a.md')
    expect(describeError('pt', revoked)).toBe('O Android revogou o acesso. Escolha a pasta de novo em ☰ → Abrir pasta.')
    expect(describeError('pt', new UnsupportedEncodingError('shift_jis'))).toContain('"shift_jis" não é suportado')
    expect(describeError('pt', new Error('boom'))).toBe('boom')
  })
})
