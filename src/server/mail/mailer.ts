import { render } from '@react-email/components'
import { Context, Data, Effect } from 'effect'
import { createElement } from 'react'
import { type TemplateName, type TemplateProps, templates } from './templates'

export interface EmailMessage {
  readonly to: string
  readonly subject: string
  readonly html: string
  readonly text: string
  readonly replyTo?: string
}

export class MailerError extends Data.TaggedError('MailerError')<{
  readonly reason: 'render' | 'send'
  readonly cause: unknown
}> {}

/**
 * Delivers an already rendered email. Providers (the mock, later a real one) implement this.
 * Programs normally call `sendEmail` instead, which renders a template first.
 */
export class Mailer extends Context.Service<
  Mailer,
  { readonly send: (message: EmailMessage) => Effect.Effect<void, MailerError> }
>()('app/Mailer') {}

/** Renders a react-email template to HTML and plain text. */
export const renderEmail = <T extends TemplateName>(template: T, props: TemplateProps<T>) =>
  Effect.tryPromise({
    try: async () => {
      const { Component, subject } = templates[template]
      // The registry is keyed by name, so TypeScript cannot pair Component with its props here.
      const element = createElement(Component as (p: TemplateProps<T>) => React.ReactNode, props)
      const [html, text] = await Promise.all([
        render(element),
        render(element, { plainText: true }),
      ])
      return { subject: (subject as (p: TemplateProps<T>) => string)(props), html, text }
    },
    catch: (cause) => new MailerError({ reason: 'render', cause }),
  })

export const sendEmail = <T extends TemplateName>(input: {
  readonly to: string
  readonly template: T
  readonly props: TemplateProps<T>
  readonly replyTo?: string
}) =>
  Effect.gen(function* () {
    const rendered = yield* renderEmail(input.template, input.props)
    const mailer = yield* Mailer
    yield* mailer.send({ to: input.to, replyTo: input.replyTo, ...rendered })
  }).pipe(Effect.withSpan('sendEmail', { attributes: { template: input.template } }))
