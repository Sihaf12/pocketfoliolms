-- The four request roles' passwords, from psql variables that
-- deploy/migrate.sh fills from the server's deploy/.env. Run on every
-- deploy, after the migrations. Not a migration: the migrations create
-- the roles with a placeholder, and real passwords never live in git.
\set ON_ERROR_STOP on
ALTER ROLE app_user    PASSWORD :'app_user';
ALTER ROLE app_control PASSWORD :'app_control';
ALTER ROLE app_studio  PASSWORD :'app_studio';
ALTER ROLE app_console PASSWORD :'app_console';
