/** Una fila devuelta por la base de datos: las columnas se leen por nombre y se convierten con los ayudantes de abajo. */
export type Row = Record<string, unknown>;

/** Lo mínimo que se necesita para ejecutar SQL: sirve tanto un pool como una conexión dentro de una transacción. */
export interface Executor {
  // `any` solo en la frontera con el controlador: los valores siempre viajan como parámetros ($1, $2…).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  query(text: string, values?: any[]): Promise<{ rows: any[]; rowCount: number | null }>;
}

/** Ejecuta una consulta parametrizada y devuelve sus filas. Nunca se concatenan valores en el SQL. */
export async function selectRows(executor: Executor, sql: string, params: unknown[] = []): Promise<Row[]> {
  const result = await executor.query(sql, params);
  return result.rows as Row[];
}

/** Ejecuta una sentencia de escritura parametrizada y devuelve cuántas filas afectó. */
export async function runStatement(executor: Executor, sql: string, params: unknown[] = []): Promise<number> {
  const result = await executor.query(sql, params);
  return result.rowCount ?? 0;
}

export const asNumber = (value: unknown): number => Number(value);
export const asString = (value: unknown): string => String(value);
export const asNullableString = (value: unknown): string | null =>
  value === null || value === undefined ? null : String(value);
