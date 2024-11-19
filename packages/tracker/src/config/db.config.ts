import { DataSource, DataSourceOptions } from 'typeorm';
// eslint-disable-next-line @typescript-eslint/no-var-requires
require('dotenv').config();
require('dotenv').config({ path: 'config/.env' });

console.log(process.env.DATABASE_DB);
console.log(process.env.DATABASE_HOST);
console.log(process.env.DATABASE_PORT);
console.log(process.env.DATABASE_USERNAME);
console.log(process.env.DATABASE_PASSWORD);
console.log(process.env.DATABASE_SSL);

const baseConfig: DataSourceOptions = {
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore
  type: process.env.DATABASE_TYPE,
  host: process.env.DATABASE_HOST,
  port: parseInt(process.env.DATABASE_PORT),
  username: process.env.DATABASE_USERNAME,
  password: process.env.DATABASE_PASSWORD,
  database: process.env.DATABASE_DB,
  synchronize: true,
  ...(process.env.DATABASE_SSL == 'true'
    ? {
        ssl: {
          rejectUnauthorized: false,
        },
      }
    : {}),
};

export const ormConfig: DataSourceOptions = {
  ...baseConfig,
  entities: ['dist/**/entities/*.entity{.js,.ts}'],
};

const cliConfig: DataSourceOptions = {
  ...baseConfig,
  entities: ['src/**/entities/*.entity{.js,.ts}'],
  migrations: ['src/**/migrations/*{.js,.ts}'],
  logger: 'file',
  logging: true,
};

const cliDataSource = new DataSource(cliConfig);
export default cliDataSource;
