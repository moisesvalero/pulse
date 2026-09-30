/**
 * Joins conditional class names. Deliberately tiny: Pulse has no need for
 * `clsx`/`tailwind-merge`, so we avoid the extra dependency.
 */
export function cn(...values: Array<string | false | null | undefined>): string {
	return values.filter((value): value is string => Boolean(value)).join(' ');
}
