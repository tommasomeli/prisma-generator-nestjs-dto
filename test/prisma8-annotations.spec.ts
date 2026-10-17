import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { isEntityHidden } from "../src/annotations";
import EntityDtoGenerator from "../src/generators/entity-generator";
import {
  extractAnnotations,
  loadPslAnnotations,
  loadPslParser,
  type PslParserModule,
} from "../src/prisma8/psl-annotations";
import type { AnnotationMap } from "../src/prisma8/types";
import { buildOptions } from "./helpers/build-options";

const BLOG_DIR = path.join(__dirname, "fixtures/prisma8/blog");
const BLOG_PSL = path.join(BLOG_DIR, "contract.prisma");

const tmpDirs: string[] = [];

/** Writes `files` into a fresh temp directory and returns its path. */
function tmpProject(files: Record<string, string>): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "psl-annotations-"));
  tmpDirs.push(dir);
  for (const [name, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, name)), { recursive: true });
    fs.writeFileSync(path.join(dir, name), content);
  }
  return dir;
}

afterEach(() => {
  while (tmpDirs.length)
    fs.rmSync(tmpDirs.pop()!, { recursive: true, force: true });
});

/** Plain-object view of a map for readable assertions. */
function toPlain(map: AnnotationMap) {
  return Object.fromEntries(
    [...map].map(([name, m]) => [
      name,
      { doc: m.doc, fields: Object.fromEntries(m.fields) },
    ]),
  );
}

describe("Prisma 8 PSL annotations", () => {
  it("loads the real parser from @prisma/orm-framework", async () => {
    const parser = await loadPslParser();
    expect(parser).not.toBeNull();
    expect(typeof parser!.parse).toBe("function");
  });

  it("extracts docs and written-type facts from the blog fixture", async () => {
    const warn = vi.fn();
    const map = await loadPslAnnotations([BLOG_PSL], { warn });
    expect(warn).not.toHaveBeenCalled();
    expect([...map.keys()]).toEqual(["Role", "User", "Post"]);

    const user = map.get("User")!;
    expect(user.doc).toBe('@Auditable("user_audit")');
    expect([...user.fields.keys()]).toEqual([
      "id",
      "email",
      "name",
      "passwordHash",
      "role",
      "bio",
      "posts",
      "createdAt",
      "updatedAt",
    ]);
    expect(user.fields.get("passwordHash")).toEqual({
      doc: "Field hidden from every emitted DTO.\n@DtoHidden",
      writtenType: "String",
      isList: false,
      isUpdatedAt: false,
    });
    expect(user.fields.get("bio")).toEqual({
      doc: undefined,
      writtenType: "VarChar(255)?",
      isList: false,
      isUpdatedAt: false,
    });
    expect(user.fields.get("posts")).toEqual({
      doc: undefined,
      writtenType: "Post[]",
      isList: true,
      isUpdatedAt: false,
    });
    expect(user.fields.get("updatedAt")).toEqual({
      doc: undefined,
      writtenType: "temporal.updatedAt()",
      isList: false,
      isUpdatedAt: true,
    });
    expect(user.fields.get("id")!.doc).toBeUndefined();

    const post = map.get("Post")!;
    expect(post.doc).toBe('@Auditable("post_audit")');
    expect(post.fields.get("title")).toEqual({
      doc: "@MaxLength(120)",
      writtenType: "String",
      isList: false,
      isUpdatedAt: false,
    });
    expect(post.fields.get("meta")!.writtenType).toBe("Jsonb?");
    expect(
      [...post.fields.values()].some((f) => f.isList || f.isUpdatedAt),
    ).toBe(false);

    const role = map.get("Role")!;
    expect(role.doc).toBeUndefined();
    expect([...role.fields.keys()]).toEqual(["ADMIN", "USER"]);
  });

  it("records type blocks, enum member docs, namespaced models and list/optional variants", async () => {
    const parser = (await loadPslParser())!;
    const source = [
      "// use prisma-8",
      "/// A point",
      "type Point {",
      "  /// x coord",
      "  x Float",
      "  y Float[]?",
      "}",
      "/// Status enum",
      "enum Status {",
      "  /// the active one",
      '  ACTIVE @map("a")',
      "",
      "  OFF",
      "}",
      "namespace billing {",
      "  /// @DtoIgnoreModel",
      "  model Invoice {",
      "    id Int @id",
      "    touchedAt temporal.updatedAt( )",
      "  }",
      "}",
    ].join("\n");
    const plain = toPlain(extractAnnotations(parser, source, "extra.prisma"));
    expect(plain).toEqual({
      Point: {
        doc: "A point",
        fields: {
          x: {
            doc: "x coord",
            writtenType: "Float",
            isList: false,
            isUpdatedAt: false,
          },
          y: {
            doc: undefined,
            writtenType: "Float[]?",
            isList: true,
            isUpdatedAt: false,
          },
        },
      },
      Status: {
        doc: "Status enum",
        fields: {
          ACTIVE: {
            doc: "the active one",
            writtenType: undefined,
            isList: false,
            isUpdatedAt: false,
          },
          OFF: {
            doc: undefined,
            writtenType: undefined,
            isList: false,
            isUpdatedAt: false,
          },
        },
      },
      Invoice: {
        doc: "@DtoIgnoreModel",
        fields: {
          id: {
            doc: undefined,
            writtenType: "Int",
            isList: false,
            isUpdatedAt: false,
          },
          touchedAt: {
            doc: undefined,
            writtenType: "temporal.updatedAt( )",
            isList: false,
            isUpdatedAt: true,
          },
        },
      },
    });
  });

  it("joins a multi-file contract into one map in file order", async () => {
    const dir = tmpProject({
      "schema/user.prisma":
        '// use prisma-8\n/// @Auditable("u")\nmodel User {\n  id Int @id\n  /// @DtoHidden\n  secret String\n  posts Post[]\n}\n',
      "schema/post.prisma":
        "// use prisma-8\nmodel Post {\n  id Int @id\n  /// @MaxLength(10)\n  title String\n  author User @relation(fields: [authorId], references: [id])\n  authorId Int\n}\n",
    });
    const map = await loadPslAnnotations(
      [
        path.join(dir, "schema/user.prisma"),
        path.join(dir, "schema/post.prisma"),
      ],
      { warn: vi.fn() },
    );
    expect([...map.keys()]).toEqual(["User", "Post"]);
    expect(map.get("User")!.doc).toBe('@Auditable("u")');
    expect(map.get("User")!.fields.get("secret")!.doc).toBe("@DtoHidden");
    expect(map.get("User")!.fields.get("posts")!.isList).toBe(true);
    expect(map.get("Post")!.fields.get("title")!.doc).toBe("@MaxLength(10)");
  });

  it("throws with the file name and diagnostics on PSL syntax errors", async () => {
    const dir = tmpProject({
      "broken.prisma": "// use prisma-8\nmodel Broken {\n  id Int @id\n",
    });
    const file = path.join(dir, "broken.prisma");
    await expect(loadPslAnnotations([file], { warn: vi.fn() })).rejects.toThrow(
      file,
    );
    await expect(loadPslAnnotations([file], { warn: vi.fn() })).rejects.toThrow(
      /PSL_UNTERMINATED_BLOCK/,
    );
  });

  it("warns once and returns an empty map when the parser is missing", async () => {
    const warn = vi.fn();
    const map = await loadPslAnnotations([BLOG_PSL, BLOG_PSL], {
      warn,
      loadParser: async () => null,
    });
    expect(map.size).toBe(0);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toContain("@prisma/orm-framework");
  });

  it("warns once and returns an empty map when the parser loader throws", async () => {
    const warn = vi.fn();
    const map = await loadPslAnnotations([BLOG_PSL], {
      warn,
      loadParser: async () => {
        throw new Error("boom");
      },
    });
    expect(map.size).toBe(0);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("warns once and returns an empty map when the parser API is incompatible", async () => {
    const warn = vi.fn();
    const legacy = {
      parse: () => ({
        document: {
          declarations: () => [
            {
              syntax: { kind: "ModelDeclaration" },
              name: () => ({ name: () => "User" }),
            },
          ],
        },
        diagnostics: [],
      }),
      printSyntax: () => "",
    } as unknown as PslParserModule;
    const map = await loadPslAnnotations([BLOG_PSL, BLOG_PSL], {
      warn,
      loadParser: async () => legacy,
    });
    expect(map.size).toBe(0);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toContain("docComment");
  });

  it("returns an empty map without loading the parser when no files are given", async () => {
    const loadParser = vi.fn(async () => null);
    const warn = vi.fn();
    expect((await loadPslAnnotations([], { warn, loadParser })).size).toBe(0);
    expect(loadParser).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
  });
});

describe("Prisma 8 PSL annotations through the existing annotation parser", () => {
  /** Prisma 7 `documentation` for the same fields: DMMF joins `///` lines with `\n`. */
  const PRISMA7_DOCS = {
    model: '@Auditable("user_audit")',
    passwordHash: "Field hidden from every emitted DTO.\n@DtoHidden",
    title: "@MaxLength(120)",
  };

  function generatorFor(docs: {
    model?: string;
    passwordHash?: string;
    title?: string;
  }) {
    return new EntityDtoGenerator(
      buildOptions({
        config: { extraAnnotations: "Auditable" },
        models: [
          {
            name: "User",
            documentation: docs.model,
            fields: [
              { name: "id", type: "Int", isId: true },
              {
                name: "passwordHash",
                type: "String",
                documentation: docs.passwordHash,
              },
            ],
          },
          {
            name: "Post",
            fields: [
              { name: "id", type: "Int", isId: true },
              { name: "title", type: "String", documentation: docs.title },
            ],
          },
        ],
      }),
    );
  }

  it("@DtoHidden, @MaxLength(120) and the custom @Auditable parse exactly as in Prisma 7 mode", async () => {
    const map = await loadPslAnnotations([BLOG_PSL], { warn: vi.fn() });
    const prisma8 = generatorFor({
      model: map.get("User")!.doc,
      passwordHash: map.get("User")!.fields.get("passwordHash")!.doc,
      title: map.get("Post")!.fields.get("title")!.doc,
    });
    const prisma7 = generatorFor(PRISMA7_DOCS);

    const user8 = prisma8.models.find((m) => m.name === "User")!;
    const post8 = prisma8.models.find((m) => m.name === "Post")!;
    const passwordHash = user8.fields.find((f) => f.name === "passwordHash")!;
    const title = post8.fields.find((f) => f.name === "title")!;

    expect(user8.annotations).toEqual([
      { name: "Auditable", params: ['"user_audit"'] },
    ]);
    expect(passwordHash.annotations).toEqual([
      { name: "DtoHidden", params: [] },
    ]);
    expect(title.annotations).toEqual([{ name: "MaxLength", params: [120] }]);
    expect(isEntityHidden(passwordHash)).toBe(true);
    expect(isEntityHidden({ documentation: passwordHash.documentation })).toBe(
      true,
    );
    expect(prisma8.hasAnnotation(user8, "Auditable")).toBe(true);

    expect(
      prisma8.models.map((m) => ({
        name: m.name,
        annotations: m.annotations,
        fields: m.fields.map((f) => [f.name, f.annotations]),
      })),
    ).toEqual(
      prisma7.models.map((m) => ({
        name: m.name,
        annotations: m.annotations,
        fields: m.fields.map((f) => [f.name, f.annotations]),
      })),
    );
    const [file8] = await prisma8.generate();
    const [file7] = await prisma7.generate();
    expect(file8.content).toBe(file7.content);
    expect(file8.content).not.toContain("passwordHash");
  });
});

describe("schemaDir @ignore scan with a Prisma 8 contract.prisma", () => {
  it("recovers @ignore fields (with their annotations) from contract.prisma", () => {
    const dir = tmpProject({
      "contract.prisma": [
        "// use prisma-8",
        "model User {",
        "  id    Int    @id @default(autoincrement())",
        "  email String @unique",
        "  /// @DtoApiHidden",
        "  legacyToken String? @ignore",
        "  updatedAt temporal.updatedAt()",
        "}",
        "",
      ].join("\n"),
    });
    const gen = new EntityDtoGenerator(
      buildOptions({
        config: { schemaDir: dir },
        models: [
          {
            name: "User",
            fields: [
              { name: "id", type: "Int", isId: true },
              { name: "email", type: "String", isUnique: true },
            ],
          },
        ],
      }),
    );
    const legacy = gen.models[0].fields.find((f) => f.name === "legacyToken");
    expect(legacy).toBeDefined();
    expect(legacy!.isRequired).toBe(false);
    expect(legacy!.annotations).toEqual([{ name: "DtoApiHidden", params: [] }]);
    expect(isEntityHidden(legacy!)).toBe(true);
    expect(gen.models[0].fields.map((f) => f.name)).toEqual([
      "id",
      "email",
      "legacyToken",
    ]);
  });

  it("scans the blog fixture directory without adding fields or warnings", () => {
    const warn = vi.spyOn(console, "info").mockImplementation(() => {});
    try {
      const gen = new EntityDtoGenerator(
        buildOptions({
          config: { schemaDir: BLOG_DIR },
          models: [
            { name: "User", fields: [{ name: "id", type: "Int", isId: true }] },
          ],
        }),
      );
      expect(gen.models[0].fields.map((f) => f.name)).toEqual(["id"]);
      expect(warn).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });
});
