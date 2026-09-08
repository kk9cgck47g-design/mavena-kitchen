import { restoreDatabase } from './db';

export default async function globalTeardown(): Promise<void> {
  await restoreDatabase();
}
