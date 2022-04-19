export function matchChanged<T>({
  prev,
  next,
  value,
}: {
  prev: T;
  next: T;
  value: T;
}) {
  return (
    (prev === value && next !== value) || (prev !== value && next === value)
  );
}
