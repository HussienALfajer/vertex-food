import { StandardSchemaValidationPipe } from '@nestjs/common';
import { DomainError } from '@vertex-food/contracts';

/**
 * Runs the contract schema each route gives `@Body({ schema })`, `@Query({ schema })` and
 * `@Param(name, { schema })` (ADR 0020: one validation source), and hands the handler the parsed
 * value, with defaults, coercion and normalization applied (a phone in E.164). A refusal is
 * `VALIDATION_FAILED` naming the fields only: an issue's message may quote the value, which can be
 * personal data (ADR 0016).
 */
export function requestValidationPipe() {
  return new StandardSchemaValidationPipe({
    transform: true,
    exceptionFactory: (issues) =>
      new DomainError('VALIDATION_FAILED', 'The request does not match its contract', {
        fields: [
          ...new Set(
            issues.map(
              (issue) =>
                issue.path
                  ?.map((segment) =>
                    typeof segment === 'object' ? String(segment.key) : String(segment),
                  )
                  .join('.') || '',
            ),
          ),
        ],
      }),
  });
}
