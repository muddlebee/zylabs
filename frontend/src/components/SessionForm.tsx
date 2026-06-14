import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../api'

interface FormState {
  company_name: string
  company_url: string
  objective: string
}

interface FieldError {
  company_name?: string
  company_url?: string
  objective?: string
}

function validate(values: FormState): FieldError {
  const errors: FieldError = {}
  if (!values.company_name.trim()) errors.company_name = 'Required'
  if (values.company_url.trim()) {
    try {
      new URL(values.company_url)
    } catch {
      errors.company_url = 'Enter a valid URL (e.g. https://stripe.com)'
    }
  }
  if (!values.objective.trim()) errors.objective = 'Required'
  else if (values.objective.trim().length < 10)
    errors.objective = 'Describe the objective in at least 10 characters'
  return errors
}

export default function SessionForm() {
  const navigate = useNavigate()
  const [values, setValues] = useState<FormState>({
    company_name: '',
    company_url: '',
    objective: '',
  })
  const [errors, setErrors] = useState<FieldError>({})
  const [submitting, setSubmitting] = useState(false)
  const [serverError, setServerError] = useState('')

  function set(field: keyof FormState) {
    return (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      setValues(v => ({ ...v, [field]: e.target.value }))
      if (errors[field]) setErrors(prev => ({ ...prev, [field]: undefined }))
    }
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    const errs = validate(values)
    if (Object.keys(errs).length) {
      setErrors(errs)
      return
    }
    setSubmitting(true)
    setServerError('')
    try {
      const { session_id } = await api.createSession(values)
      await api.runSession(session_id)
      navigate(`/sessions/${session_id}`)
    } catch (err) {
      setServerError(err instanceof Error ? err.message : 'Something went wrong')
      setSubmitting(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="space-y-5">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        <Field
          label="Company Name"
          id="company_name"
          placeholder="Stripe"
          value={values.company_name}
          onChange={set('company_name')}
          error={errors.company_name}
        />
        <Field
          label="Company Website (optional, e.g. https://stripe.com)"
          id="company_url"
          type="url"
          placeholder="https://stripe.com"
          value={values.company_url}
          onChange={set('company_url')}
          error={errors.company_url}
        />
      </div>

      <div>
        <label htmlFor="objective" className="block text-sm font-medium text-ink-2 mb-1.5">
          Research Objective
        </label>
        <textarea
          id="objective"
          rows={3}
          placeholder="Understand their payment infrastructure needs ahead of our enterprise demo next week…"
          value={values.objective}
          onChange={set('objective')}
          className={`w-full px-4 py-3 bg-surface border rounded-lg text-sm text-ink placeholder-ink-3 resize-none
            focus:outline-none focus:ring-2 focus:ring-accent/30 focus:border-accent transition-colors
            ${errors.objective ? 'border-c-red' : 'border-c-border'}`}
        />
        {errors.objective && (
          <p className="mt-1 text-xs text-c-red">{errors.objective}</p>
        )}
      </div>

      {serverError && (
        <div className="px-4 py-3 bg-c-red-lt border border-c-red/30 rounded-lg text-sm text-c-red">
          {serverError}
        </div>
      )}

      <button
        type="submit"
        disabled={submitting}
        className="w-full py-3 px-6 bg-ink text-bg text-sm font-medium rounded-lg
          hover:bg-ink-2 active:scale-[0.99] transition-all disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {submitting ? (
          <span className="flex items-center justify-center gap-2">
            <Spinner /> Starting research…
          </span>
        ) : (
          'Start Research'
        )}
      </button>
    </form>
  )
}

function Field({
  label, id, type = 'text', placeholder, value, onChange, error,
}: {
  label: string
  id: string
  type?: string
  placeholder: string
  value: string
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void
  error?: string
}) {
  return (
    <div>
      <label htmlFor={id} className="block text-sm font-medium text-ink-2 mb-1.5">
        {label}
      </label>
      <input
        id={id}
        type={type}
        placeholder={placeholder}
        value={value}
        onChange={onChange}
        className={`w-full px-4 py-3 bg-surface border rounded-lg text-sm text-ink placeholder-ink-3
          focus:outline-none focus:ring-2 focus:ring-accent/30 focus:border-accent transition-colors
          ${error ? 'border-c-red' : 'border-c-border'}`}
      />
      {error && <p className="mt-1 text-xs text-c-red">{error}</p>}
    </div>
  )
}

function Spinner() {
  return (
    <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor"
        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
    </svg>
  )
}
