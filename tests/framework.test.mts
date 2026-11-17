import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { Project } from 'ts-morph';
import { analyseFramework } from '../lib/adapters/index.mts';

async function fixture(manifest: unknown, files: Record<string, string>, check: (root: string, sources: {path: string; source: import('ts-morph').SourceFile}[]) => Promise<void>) {
  const root = await mkdtemp(path.join(tmpdir(), 'cartograph-framework-'));
  const project = new Project({ useInMemoryFileSystem: true, compilerOptions: { experimentalDecorators: true } });
  try {
    if (manifest !== undefined) await writeFile(path.join(root, 'package.json'), JSON.stringify(manifest));
    const sources = [];
    for (const [file, text] of Object.entries(files)) {
      await mkdir(path.dirname(path.join(root, file)), { recursive: true });
      await writeFile(path.join(root, file), text);
      sources.push({path: file, source: project.createSourceFile('/'+file, text)});
    }
    await check(root, sources);
  } finally { await rm(root, {recursive: true, force: true}); }
}
const next = { dependencies: {next: '16', react: '19', '@nestjs/core': '11'} };
const nest = { dependencies: {'@nestjs/core': '11', '@nestjs/common': '11', react: '19'} };

test('Next categories include framework UI, middleware, metadata, instrumentation and tests without inventing endpoints', async () => {
  await fixture(next, {
    'app/page.tsx': 'export const metadata = {title: "Home"}; export default function Page(){return <main/>}',
    'app/loading.tsx': 'export default function Loading(){return <p/>}',
    'app/(shop)/error.tsx': 'export default function Error(){return <p/>}',
    'app/@modal/default.tsx': 'export default function Default(){return null}',
    'app/global-error.tsx': 'export default function Error(){return <html/>}',
    'app/not-found.tsx': 'export default function Missing(){return <p/>}',
    'app/global-not-found.tsx': 'export default function Missing(){return <html/>}',
    'app/template.tsx': 'export default function Template(){return <main/>}',
    'app/robots.ts': 'export default function robots(){return {rules:[]}}',
    'app/manifest.ts': 'export default function manifest(){return {name:"Example"}}',
    'app/products/sitemap.ts': 'export default function sitemap(){return []}',
    'app/products/opengraph-image.tsx': 'export default function Image(){return new Response()}',
    'middleware.ts': 'export function middleware(){}',
    'src/proxy.ts': 'export function proxy(){}',
    'instrumentation.ts': 'export function register(){}',
    'src/instrumentation-client.ts': 'console.log("setup")',
    'components/button.spec.tsx': 'export {}',
    'tests/integration.mts': 'export {}',
    '__tests__/helper.ts': 'export {}',
    'next.config.ts': 'export default {}',
    'lib/middleware.ts': 'export const helper = 1',
    'lib/metadata.ts': 'export const title = "Example"',
    'components/loading.tsx': 'export default function Loading(){return <p/>}',
    'app/_private/loading.tsx': 'export default function Loading(){return <p/>}',
    'src/app/loading.tsx': 'export default function Loading(){return <p/>}',
    'app/products/robots.ts': 'export default function robots(){return {rules:[]}}',
  }, async (root, sources) => {
    const facts = await analyseFramework(root, sources);
    const paths = (role: string) => facts.roles.filter(item => item.role === role).map(item => item.path).sort();
    assert.deepEqual(paths('loading-error'), ['app/(shop)/error.tsx','app/@modal/default.tsx','app/global-error.tsx','app/global-not-found.tsx','app/loading.tsx','app/not-found.tsx'].sort());
    assert.deepEqual(paths('layout'), ['app/template.tsx']);
    assert.deepEqual(paths('middleware'), ['middleware.ts','src/proxy.ts']);
    assert.deepEqual(paths('metadata'), ['app/manifest.ts','app/products/opengraph-image.tsx','app/products/sitemap.ts','app/robots.ts']);
    assert.deepEqual(paths('instrumentation'), ['instrumentation.ts','src/instrumentation-client.ts']);
    assert.deepEqual(paths('test'), ['__tests__/helper.ts','components/button.spec.tsx','tests/integration.mts']);
    assert.deepEqual(paths('config'), ['next.config.ts']);
    assert.deepEqual(facts.routes, [{file:'app/page.tsx',method:'GET',path:'/'}]);
  });
});

test('Next Pages special layout and error categories apply only at the pages root', async () => {
  await fixture(next, {
    'pages/_app.tsx': 'export default function App(){return <main/>}',
    'pages/_document.tsx': 'export default function Document(){return <html/>}',
    'pages/_error.tsx': 'export default function Error(){return <p/>}',
    'pages/blog/_app.tsx': 'export default function Page(){return <main/>}',
    'pages/blog/_document.tsx': 'export default function Page(){return <main/>}',
    'pages/blog/_error.tsx': 'export default function Page(){return <main/>}',
  }, async (root, sources) => {
    const facts = await analyseFramework(root, sources);
    assert.deepEqual(facts.roles.filter(item => item.role === 'layout').map(item => item.path), ['pages/_app.tsx','pages/_document.tsx']);
    assert.deepEqual(facts.roles.filter(item => item.role === 'loading-error').map(item => item.path), ['pages/_error.tsx']);
    assert.deepEqual(facts.routes.map(item => item.path), ['/blog/_app','/blog/_document','/blog/_error']);
  });
});

test('root declaration precedence, string entries, peer dependencies and generic fallback', async () => {
  for (const [manifest, expected] of [[next, 'nextjs'], [nest, 'nestjs'], [{peerDependencies: {react: '*'}}, 'react'], [{dependencies: {next: 1, react: null}}, null], [undefined, null]] as const) {
    await fixture(manifest, {'packages/sub/package.json': '{"dependencies":{"next":"16"}}'}, async (root, sources) => {
      assert.equal((await analyseFramework(root, sources)).framework, expected);
    });
  }
});

test('manifest malformed JSON and outside symlink fail loudly', async () => {
  await fixture(undefined, {}, async (root, sources) => {
    await writeFile(path.join(root, 'package.json'), '{');
    await assert.rejects(analyseFramework(root, sources), /JSON|manifest/i);
    await rm(path.join(root, 'package.json'));
    const outside = `${root}-outside.json`;
    await symlink(outside, path.join(root, 'package.json'));
    await writeFile(outside, '{}');
    try { await assert.rejects(analyseFramework(root, sources), /outside the repository/); }
    finally { await rm(outside); }
  });
});

test('Next routes derive only from active conventions and actual exported handlers', async () => {
  const files = {
    'app/(shop)/users/[id]/page.tsx': 'export default function Page(){return <main/>}',
    'app/api/users/route.ts': 'const handle = () => new Response(); export {handle as POST}; export const GET = 4;',
    'app/api/not-exported/route.ts': 'function GET() {}',
    'app/no-default/page.tsx': 'export const value = 1',
    'app/_private/page.tsx': 'export default function Page(){return <main/>}',
    'app/@modal/(.)photo/page.tsx': 'export default function Page(){return <main/>}',
    'src/app/ignored/page.tsx': 'export default function Page(){return <main/>}',
    'packages/widget/app/page.tsx': 'export default function Page(){return <main/>}',
    'app/layout.tsx': 'export default function Layout(){return <main/>}',
    'app/actions.ts': 'export async function save(){"use server";}',
  };
  await fixture(next, files, async (root, sources) => {
    const facts = await analyseFramework(root, sources);
    assert.deepEqual(facts.routes, [
      {file:'app/(shop)/users/[id]/page.tsx', method:'GET', path:'/users/[id]'},
      {file:'app/api/users/route.ts', method:'POST', path:'/api/users'},
    ]);
    assert(facts.roles.some(role => role.path === 'app/actions.ts' && role.role === 'server-action'));
    assert(facts.roles.some(role => role.path === 'app/layout.tsx' && role.role === 'layout'));
    assert.deepEqual(await analyseFramework(root, [...sources].reverse()), facts);
  });
});

test('Next Pages index and dynamic patterns; API methods remain absent', async () => {
  await fixture(next, {
    'src/pages/index.tsx': 'export default function Home(){return <main/>}',
    'src/pages/posts/[...slug].tsx': 'export default function Post(){return <main/>}',
    'src/pages/_app.tsx': 'export default function App(){return <main/>}',
    'src/pages/api/users.ts': 'export default function handler(req,res){res.end()}',
  }, async (root, sources) => {
    const facts = await analyseFramework(root, sources);
    assert.deepEqual(facts.routes.map(route => route.path), ['/', '/posts/[...slug]']);
    assert(facts.roles.some(role => role.path === 'src/pages/api/users.ts' && role.role === 'api'));
  });
});

test('Next matches the longest configured page extension regardless of configuration order', async () => {
  for (const pageExtensions of [['tsx', 'page.tsx'], ['page.tsx', 'tsx']]) {
    await fixture(next, {
      'next.config.ts': `export default {pageExtensions: ${JSON.stringify(pageExtensions)}}`,
      'pages/about.page.tsx': 'export default function About(){return <main/>}',
      'pages/index.page.tsx': 'export default function Home(){return <main/>}',
      'pages/plain.tsx': 'export default function Plain(){return <main/>}',
      'pages/_app.page.tsx': 'export default function App(){return <main/>}',
    }, async (root, sources) => {
      const facts = await analyseFramework(root, sources);
      assert.deepEqual(facts.routes, [
        {file:'pages/about.page.tsx', method:'GET', path:'/about'},
        {file:'pages/index.page.tsx', method:'GET', path:'/'},
        {file:'pages/plain.tsx', method:'GET', path:'/plain'},
      ]);
      assert.ok(facts.roles.some(role => role.path === 'pages/_app.page.tsx' && role.role === 'layout'));
    });
  }
});

test('Next literal basePath works and unknown configuration never invents paths', async () => {
  for (const [config, expected] of [
    ['const config = {basePath: "/docs"}; export default config', ['/docs']],
    ['export default {basePath: process.env.PREFIX}', []],
    ['export default withPlugin({})', []],
    ['module.exports = { rewrites: async () => [] }', []],
    ['export default {pageExtensions: ["page.tsx"]}', []],
  ] as const) {
    await fixture(next, {'next.config.ts': config, 'app/page.tsx': 'export default function Home(){return <main/>}'}, async (root, sources) => {
      assert.deepEqual((await analyseFramework(root, sources)).routes.map(route => route.path), expected);
    });
  }
});

test('Nest literal decorator aliases compose full paths and suffix roles', async () => {
  await fixture(nest, {
    'src/cats.controller.ts': 'import { Controller as C, Get as G, Post } from "@nestjs/common"; @C("cats") export class Cats { @G(":id") get(){} @Post() create(){} }',
    'src/main.ts': 'import {NestFactory} from "@nestjs/core"; async function bootstrap(){ const app = await NestFactory.create(AppModule); app.setGlobalPrefix("api"); await app.listen(3000); } bootstrap();',
    'src/cats.service.ts': 'export class CatsService {}',
    'src/cats.module.ts': 'export class CatsModule {}',
    'src/cat.entity.ts': 'export class Cat {}',
  }, async (root, sources) => {
    const facts = await analyseFramework(root, sources);
    assert.deepEqual(facts.routes, [
      {file:'src/cats.controller.ts', method:'GET', path:'/api/cats/:id'},
      {file:'src/cats.controller.ts', method:'POST', path:'/api/cats'},
    ]);
    assert.deepEqual(facts.roles.map(role => role.role).sort(), ['controller','entity','module','service']);
  });
});

test('Nest withholds routes when multiple HTTP applications make controller ownership uncertain', async () => {
  const controllers = {
    'cats.controller.ts': 'import {Controller, Get} from "@nestjs/common"; @Controller("cats") export class CatsController {@Get() get(){}}',
    'admin.controller.ts': 'import {Controller, Get} from "@nestjs/common"; @Controller("users") export class AdminController {@Get() get(){}}',
    'public.module.ts': 'import {Module} from "@nestjs/common"; import {CatsController} from "./cats.controller"; @Module({controllers:[CatsController]}) export class PublicModule {}',
    'admin.module.ts': 'import {Module} from "@nestjs/common"; import {AdminController} from "./admin.controller"; @Module({controllers:[AdminController]}) export class AdminModule {}',
  };
  const imports = 'import {NestFactory} from "@nestjs/core"; import {PublicModule} from "./public.module"; import {AdminModule} from "./admin.module";';
  const bootstraps: Record<string, string>[] = [
    { 'main.ts': `${imports} async function bootstrap(){const publicApp = await NestFactory.create(PublicModule); const adminApp = await NestFactory.create(AdminModule); adminApp.setGlobalPrefix("admin");}` },
    { 'main.ts': `${imports} async function bootstrap(){const adminApp = await NestFactory.create(AdminModule); adminApp.setGlobalPrefix("admin"); const publicApp = await NestFactory.create(PublicModule);}` },
    { 'main.ts': `${imports} async function bootstrap(){const publicApp = await NestFactory["create"](PublicModule); const adminApp = await NestFactory.create(AdminModule); adminApp.setGlobalPrefix("admin");}` },
    { 'main.ts': `${imports} import * as core from "@nestjs/core"; async function bootstrap(){const publicApp = await core["NestFactory"].create(PublicModule); const adminApp = await NestFactory.create(AdminModule); adminApp.setGlobalPrefix("admin");}` },
    {
      'public-main.ts': 'import {NestFactory as Factory} from "@nestjs/core"; import {PublicModule} from "./public.module"; async function bootstrap(){const app = await Factory.create(PublicModule);}',
      'admin-main.ts': 'import * as core from "@nestjs/core"; import {AdminModule} from "./admin.module"; async function bootstrap(){const app = await core.NestFactory.create(AdminModule); app.setGlobalPrefix("admin");}',
    },
    { 'main.ts': `${imports} async function bootstrap(){await NestFactory.create(PublicModule); await NestFactory.create(AdminModule);}` },
  ];
  for (const bootstrap of bootstraps) {
    await fixture(nest, { ...controllers, ...bootstrap }, async (root, sources) => {
      const facts = await analyseFramework(root, sources);
      assert.deepEqual(facts.routes, []);
      assert.deepEqual(facts.roles, [
        {path:'admin.controller.ts', role:'controller'}, {path:'admin.module.ts', role:'module'},
        {path:'cats.controller.ts', role:'controller'}, {path:'public.module.ts', role:'module'},
      ]);
    });
  }
});

test('Nest single HTTP application keeps its prefix alongside non-HTTP factories', async () => {
  await fixture(nest, {
    'cats.controller.ts': 'import {Controller, Get} from "@nestjs/common"; @Controller("cats") class Cats {@Get() get(){}}',
    'main.ts': 'import {NestFactory} from "@nestjs/core"; import * as other from "./other"; async function bootstrap(){await NestFactory.createApplicationContext(WorkerModule); await NestFactory.createMicroservice(WorkerModule); otherFactory.create(); other["NestFactory"].create(OtherModule); const app = await NestFactory.create(AppModule); app.setGlobalPrefix("api");}',
  }, async (root, sources) => {
    assert.deepEqual((await analyseFramework(root, sources)).routes, [{file:'cats.controller.ts', method:'GET', path:'/api/cats'}]);
  });
});

test('Nest fake decorators, dynamic paths, versioning and mounts produce no guessed routes', async () => {
  const controller = 'import {Controller, Get} from "@nestjs/common"; @Controller("cats") class Cats {@Get(":id") get(){}}';
  for (const extra of ['app.setGlobalPrefix(process.env.PREFIX)', 'app.setGlobalPrefix("api", {exclude:["health"]})', 'app.enableVersioning()', 'RouterModule.register([{path:"admin",module:CatsModule}])']) {
    await fixture(nest, {'src/cats.controller.ts':controller, 'src/main.ts':extra}, async (root,sources) => {
      assert.deepEqual((await analyseFramework(root,sources)).routes, []);
    });
  }
  await fixture(nest, {
    'fake.controller.ts': 'import { Controller, Get } from "./fake"; @Controller("fake") class Fake {@Get() get(){}}',
    'dynamic.controller.ts': 'import { Controller, Get } from "@nestjs/common"; @Controller(prefix) class Dynamic {@Get("list") list(){}}',
    'mixed.controller.ts': 'import { Controller, Get } from "@nestjs/common"; @Controller("cats") class Cats {@Get(dynamic) get(){}}',
  }, async (root,sources) => {assert.deepEqual((await analyseFramework(root,sources)).routes, []);});
});

test('React roles require parsed exported JSX, hooks or imported context factories', async () => {
  await fixture({dependencies:{react:'19'}}, {
    'Button.tsx': 'export function Button(){return <button/>}',
    'empty.tsx': 'export const text = "not a component"',
    'private.tsx': 'function Hidden(){return <main/>}',
    'useThing.ts': 'import {useState} from "react"; export function useThing(){return useState(0)}',
    'context.ts': 'import { createContext as context } from "react"; export const Theme = context(null)',
    'fake.ts': 'const createContext = x => x; export const Theme = createContext(null)',
  }, async (root,sources) => {
    assert.deepEqual((await analyseFramework(root,sources)).roles, [
      {path:'Button.tsx',role:'component'}, {path:'context.ts',role:'context'}, {path:'useThing.ts',role:'hook'},
    ]);
  });
});

test('Next config mutations and excluded source roots suppress uncertain routes', async () => {
  await fixture(next, {'next.config.ts':'const config = {}; Object.assign(config, {basePath:"/hidden"}); export default config', 'app/page.tsx':'export default function Page(){return <main/>}'}, async (root,sources) => {
    assert.deepEqual((await analyseFramework(root,sources)).routes, []);
  });
  await fixture(next, {'app/README.md':'root app wins', 'src/app/page.tsx':'export default function Page(){return <main/>}'}, async (root,sources) => {
    assert.deepEqual((await analyseFramework(root,sources.filter(item => !item.path.endsWith('.md')))).routes, []);
  });
});

test('Nest never treats another object prefix or custom metadata decorators as proven routing', async () => {
  const controller = 'import {Controller, Get} from "@nestjs/common"; @Controller("cats") class Cats {@Get() get(){}}';
  await fixture(nest, {'cats.controller.ts':controller, 'main.ts':'const app = createSomething(); app.setGlobalPrefix("fake")'}, async (root,sources) => {
    assert.deepEqual((await analyseFramework(root,sources)).routes, []);
  });
  await fixture(nest, {'cats.controller.ts':'import {Controller, Get} from "@nestjs/common"; import {Custom} from "./custom"; @Controller("cats") @Custom() class Cats {@Get() get(){}}'}, async (root,sources) => {
    assert.deepEqual((await analyseFramework(root,sources)).routes, []);
  });
});

test('manifest loop errors stay loud and internal symlinks stay inside the root', async () => {
  await fixture(undefined, {'manifest.json':'{"dependencies":{"react":"19"}}'}, async (root,sources) => {
    await symlink('manifest.json',path.join(root,'package.json'));
    assert.equal((await analyseFramework(root,sources)).framework,'react');
    await rm(path.join(root,'package.json'));
    await symlink('package.json',path.join(root,'package.json'));
    await assert.rejects(analyseFramework(root,sources), /ELOOP/);
  });
});

test('Nest computed global configuration and shadowed imports are omitted', async () => {
  const controller = 'import {Controller, Get} from "@nestjs/common"; @Controller("cats") class Cats {@Get() get(){}}';
  await fixture(nest, {'cats.controller.ts':controller, 'main.ts':'app["setGlobalPrefix"]("api")'}, async (root,sources) => {
    assert.deepEqual((await analyseFramework(root,sources)).routes,[]);
  });
  await fixture(nest, {'cats.controller.ts':'import {Controller,Get} from "@nestjs/common"; function local(Controller,Get){@Controller("fake") class Fake {@Get() get(){}}}'}, async (root,sources) => {
    assert.deepEqual((await analyseFramework(root,sources)).routes,[]);
  });
});

test('Next mutable handlers do not prove an HTTP implementation', async () => {
  await fixture(next, {'app/api/route.ts':'export let GET = () => new Response(); GET = arbitraryHandler;'}, async (root,sources) => {
    assert.deepEqual((await analyseFramework(root,sources)).routes,[]);
  });
});

test('Nest conditional prefix calls never imply one full route pattern', async () => {
  const controller = 'import {Controller, Get} from "@nestjs/common"; @Controller("cats") class Cats {@Get() get(){}}';
  for (const statement of [
    'process.env.PREFIX && app.setGlobalPrefix("api")',
    'process.env.PREFIX || app.setGlobalPrefix("api")',
    'process.env.PREFIX ?? app.setGlobalPrefix("api")',
    'for (const value of values) { app.setGlobalPrefix("api"); }',
    'for (const key in values) { app.setGlobalPrefix("api"); }',
    'do { app.setGlobalPrefix("api"); } while (condition);',
    'switch (process.env.PREFIX) {case "api": app.setGlobalPrefix("api");}',
    'try { app.setGlobalPrefix("api"); } catch {}',
  ]) {
    await fixture(nest, {'cats.controller.ts':controller, 'main.ts':`import {NestFactory} from "@nestjs/core"; async function bootstrap(){const app = await NestFactory.create(AppModule); ${statement}; await app.listen(3000);} bootstrap();`}, async (root,sources) => {
      assert.deepEqual((await analyseFramework(root,sources)).routes,[], statement);
    });
  }
});

test('Nest namespace RouterModule references remain uncertain through aliases', async () => {
  const controller = 'import {Controller, Get} from "@nestjs/common"; @Controller("cats") class Cats {@Get() get(){}}';
  for (const imports of [
    'import * as core from "@nestjs/core"; const routing = core.RouterModule;',
    'import * as core from "@nestjs/core"; const routing = core["RouterModule"];',
    'import {RouterModule as routing} from "@nestjs/core";',
  ]) {
    await fixture(nest, {'cats.controller.ts':controller, 'app.module.ts':`${imports} routing.register([{path:"admin",module:CatsModule}]);`}, async (root,sources) => {
      assert.deepEqual((await analyseFramework(root,sources)).routes,[]);
    });
  }
});

test('optional root dependencies participate in framework precedence', async () => {
  await fixture({optionalDependencies:{next:'16'},dependencies:{react:'19'}}, {}, async (root,sources) => {
    assert.equal((await analyseFramework(root,sources)).framework,'nextjs');
  });
});

test('Next type-only exports cannot supply runtime handlers or page defaults', async () => {
  for (const declaration of ['export type { GET } from "../handler";', 'export { type GET } from "../handler";']) {
    await fixture(next, {'handler.ts':'export function GET(){return new Response()}', 'app/route.ts':declaration}, async (root,sources) => {
      assert.deepEqual((await analyseFramework(root,sources)).routes,[], declaration);
    });
  }
  for (const declaration of ['export type { Page as default } from "../component";', 'export { type Page as default } from "../component";']) {
    await fixture(next, {'component.tsx':'export function Page(){return <main/>}', 'app/page.tsx':declaration}, async (root,sources) => {
      assert.deepEqual((await analyseFramework(root,sources)).routes,[], declaration);
    });
  }
});

test('Next runtime re-exports retain routes but transitive type-only exports do not', async () => {
  await fixture(next, {
    'handlers.ts':'export function get(){return new Response()}',
    'app/route.ts':'export {get as GET} from "../handlers";',
    'component.tsx':'export function Page(){return <main/>}',
    'app/page.tsx':'export {Page as default} from "../component";',
  }, async (root,sources) => {
    assert.deepEqual((await analyseFramework(root,sources)).routes, [
      {file:'app/page.tsx',method:'GET',path:'/'},
      {file:'app/route.ts',method:'GET',path:'/'},
    ]);
  });
  for (const barrel of ['export type {GET} from "./handler";', 'export type * from "./handler";']) {
    await fixture(next, {'handler.ts':'export function GET(){return new Response()}', 'barrel.ts':barrel, 'app/route.ts':'export {GET} from "../barrel";'}, async (root,sources) => {
      assert.deepEqual((await analyseFramework(root,sources)).routes,[]);
    });
  }
  await fixture(next, {'handler.ts':'export function GET(){return new Response()}', 'app/route.ts':'import type {GET} from "../handler"; export {GET};'}, async (root,sources) => {
    assert.deepEqual((await analyseFramework(root,sources)).routes,[]);
  });
});

test('Next erased ambient exports cannot supply runtime pages or handlers', async () => {
  for (const declaration of [
    'declare class Page {} export default Page;',
    'export default class Page {}',
    'export declare class Page {} export {Page as default};',
    'declare function Page(): unknown; export default Page;',
    'declare const Page: () => unknown; export default Page;',
    'export declare function GET(): Response;',
    'export declare const GET: () => Response;',
  ]) {
    const realClass = declaration === 'export default class Page {}';
    const file = declaration.includes('GET') ? 'app/route.ts' : 'app/page.tsx';
    await fixture(next, {[file]:declaration}, async (root,sources) => {
      assert.deepEqual((await analyseFramework(root,sources)).routes,realClass ? [{file,method:'GET',path:'/'}] : [], declaration);
    });
  }
});

test('Nest aliased global-prefix setters cannot imply an unprefixed route', async () => {
  const controller = 'import {Controller, Get} from "@nestjs/common"; @Controller("cats") class Cats {@Get() get(){}}';
  for (const statement of [
    'const setPrefix = app.setGlobalPrefix.bind(app); setPrefix("api");',
    'const {setGlobalPrefix: setPrefix} = app; setPrefix("api");',
  ]) {
    await fixture(nest, {'cats.controller.ts':controller, 'main.ts':`import {NestFactory} from "@nestjs/core"; async function bootstrap(){const app = await NestFactory.create(AppModule); ${statement} await app.listen(3000);} bootstrap();`}, async (root,sources) => {
      assert.deepEqual((await analyseFramework(root,sources)).routes,[], statement);
    });
  }
});
