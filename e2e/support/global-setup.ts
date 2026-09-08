import { prepareDatabase } from './db';

export default async function globalSetup(): Promise<void> {
  await prepareDatabase();
}
