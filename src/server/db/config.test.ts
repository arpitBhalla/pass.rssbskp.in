import { describe, expect, it } from 'vitest';
import { pgConfig } from '.';
import { DO_CA } from './doCa';

describe('database connection settings', () => {
  it('checks a DigitalOcean server against the CA in the code, whatever the address says about ssl', () => {
    const c = pgConfig('postgresql://app:pw@db-x-0.c.db.ondigitalocean.com:25060/passes?sslmode=verify-full&sslrootcert=certs/do-ca.crt');
    expect(c.connectionString).toBe('postgresql://app:pw@db-x-0.c.db.ondigitalocean.com:25060/passes');
    expect(c.ssl).toEqual({ ca: DO_CA });
    expect(pgConfig('postgresql://app:pw@db-x-0.c.db.ondigitalocean.com:25060/passes?sslmode=require').ssl).toEqual({ ca: DO_CA });
  });

  it('leaves other addresses as they are', () => {
    expect(pgConfig('postgres://localhost:5432/passes')).toEqual({ connectionString: 'postgres://localhost:5432/passes' });
  });
});
