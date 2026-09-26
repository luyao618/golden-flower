import { useId, type InputHTMLAttributes, type Ref } from 'react'

type FieldProps = InputHTMLAttributes<HTMLInputElement> & {
  label: string
  hint?: string
  error?: string
  ref?: Ref<HTMLInputElement>
}

export default function Field({ label, hint, error, id, className = '', 'aria-describedby': describedBy, ...props }: FieldProps) {
  const generatedId = useId()
  const fieldId = id ?? generatedId
  const description = [describedBy, hint && `${fieldId}-hint`, error && `${fieldId}-error`].filter(Boolean).join(' ')
  return <div className="gf-field">
    <label htmlFor={fieldId}>{label}</label>
    <input {...props} id={fieldId} className={`gf-input ${className}`}
      aria-invalid={error ? true : props['aria-invalid']} aria-describedby={description || undefined} />
    {hint && <p id={`${fieldId}-hint`} className="gf-muted">{hint}</p>}
    {error && <p id={`${fieldId}-error`} className="gf-field-error">{error}</p>}
  </div>
}
