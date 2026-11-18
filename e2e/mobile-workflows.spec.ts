import { expect, test, type Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";

// Each browser gets its own workspace in the disposable local Supabase stack.
test.skip(!process.env.BOARED_LOCAL_MOBILE, "Runs in the seeded mobile workflow");
test("report with markup, triage, follow the reply, and answer a blocking question", async ({
  page,
  context,
}) => {
  test.setTimeout(120_000);
  const url = process.env.SUPABASE_URL!;
  if (!["localhost", "127.0.0.1"].includes(new URL(url).hostname))
    throw new Error("Expected a local test database");
  const db = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  });
  const workspace = randomUUID();
  const project = randomUUID();
  const password = randomUUID();
  const title = "Checkout screenshot";
  const question = "Which checkout should we ship?";
  async function person(role: "admin" | "client") {
    const email = role + "-" + workspace + "@example.com";
    const { data, error } = await db.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { full_name: role, deadline_reminders: role === "admin" },
    });
    if (error) throw error;
    await db
      .from("workspace_members")
      .insert({ workspace_id: workspace, user_id: data.user.id, role })
      .throwOnError();
    if (role === "admin")
      await db
        .from("user_roles")
        .insert({ user_id: data.user.id, workspace_id: workspace, role })
        .throwOnError();
    await db
      .from("project_members")
      .insert({ project_id: project, user_id: data.user.id, role })
      .throwOnError();
    const login = createClient(url, process.env.SUPABASE_PUBLISHABLE_KEY!, {
      auth: { persistSession: false },
    });
    const auth = await login.auth.signInWithPassword({ email, password });
    if (auth.error) throw auth.error;
    return auth.data.session;
  }
  await db
    .from("workspaces")
    .insert({ id: workspace, slug: "mobile-" + workspace, name: "Mobile test" })
    .throwOnError();
  await db
    .from("projects")
    .insert({ id: project, workspace_id: workspace, title: "Storefront" })
    .throwOnError();
  const client = await person("client");
  const admin = await person("admin");
  async function signIn(target: Page, session: typeof client) {
    await target.addInitScript(
      ({ workspace, key, session }) => {
        localStorage.setItem("cf.activeWorkspaceId", workspace);
        localStorage.setItem(key, JSON.stringify(session));
      },
      { workspace, key: "sb-" + new URL(url).hostname.split(".")[0] + "-auth-token", session },
    );
  }
  await signIn(page, client);
  await page.goto("/app/report?project=" + project);
  const screenshot = await page.evaluate(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 320;
    canvas.height = 200;
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "white";
    ctx.fillRect(0, 0, 320, 200);
    ctx.fillStyle = "black";
    ctx.fillText("Checkout", 20, 50);
    return canvas.toDataURL().split(",")[1];
  });
  await page
    .locator('input[type=file][accept="image/*"][multiple]')
    .first()
    .setInputFiles({
      name: "checkout.png",
      mimeType: "image/png",
      buffer: Buffer.from(screenshot, "base64"),
    });
  await page.getByRole("button", { name: /Mark up checkout.png/ }).click();
  const canvas = page.locator("canvas").first();
  const box = await canvas.boundingBox();
  expect(box).toBeTruthy();
  await page.mouse.move(box!.x + 20, box!.y + 20);
  await page.mouse.down();
  await page.mouse.move(box!.x + 60, box!.y + 60);
  await page.mouse.up();
  await page.getByRole("button", { name: "Done", exact: true }).click();
  await expect(page.getByText("Marked", { exact: true })).toBeVisible();
  await page.getByLabel("Short title").fill(title);
  const markedUpload = /\/storage\/v1\/object\/attachments\/.*-marked\.(webp|png)$/;
  await page.route(markedUpload, (route) =>
    route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({ message: "Temporary upload failure" }),
    }),
  );
  await page.getByRole("button", { name: "Send to Storefront" }).click();
  await expect(page.getByText("1 of 2 files attached")).toBeVisible();
  await page.unroute(markedUpload);
  await page.getByRole("button", { name: "Retry failed files" }).click();
  await expect(page).toHaveURL(/\/app\/tickets\/[\w-]+/);
  const ticketId = new URL(page.url()).pathname.split("/").pop()!;
  const files = await db
    .from("ticket_attachments")
    .select("kind")
    .eq("ticket_id", ticketId)
    .throwOnError();
  expect(files.data?.map((row) => row.kind).sort()).toEqual(["annotated", "screenshot"]);
  expect(
    (await db.from("tickets").select("id").eq("project_id", project).throwOnError()).data,
  ).toHaveLength(1);
  await db
    .from("tickets")
    .update({ sla_due_at: new Date(Date.now() + 3600000).toISOString() })
    .eq("id", ticketId)
    .throwOnError();
  // Separate contexts prevent the client and admin from sharing auth storage.
  const agency = await context
    .browser()!
    .newContext({ ...test.info().project.use, baseURL: test.info().project.use.baseURL });
  try {
    const staff = await agency.newPage();
    await signIn(staff, admin);
    await staff.goto("/app/triage");
    await staff.getByText(/ticket deadlines need attention/).click();
    await staff
      .locator("details")
      .getByRole("link", { name: new RegExp(title) })
      .click();
    await staff.getByRole("button", { name: "Assign to me", exact: true }).click();
    await expect
      .poll(
        async () =>
          (await db.from("tickets").select("assignee_id").eq("id", ticketId).single()).data
            ?.assignee_id,
      )
      .toBe(admin.user.id);
    await staff.getByRole("button", { name: /Reply to the client…/ }).click();
    await staff.locator("[contenteditable=true]").fill("We are checking this now.");
    await staff.getByRole("button", { name: "Send reply" }).click();
    await expect(
      staff.getByText("We are checking this now.", { exact: true }).first(),
    ).toBeVisible();
    await page.reload();
    await expect(
      page.getByText("We are checking this now.", { exact: true }).first(),
    ).toBeVisible();
  } finally {
    await agency.close();
  }
  const plan = randomUUID(),
    section = randomUUID(),
    task = randomUUID();
  await db
    .from("plans")
    .insert({
      id: plan,
      workspace_id: workspace,
      project_id: project,
      title: "Release",
      clients_can_view: true,
    })
    .throwOnError();
  await db
    .from("plan_sections")
    .insert({ id: section, plan_id: plan, title: "Decisions" })
    .throwOnError();
  await db
    .from("plan_tasks")
    .insert({
      id: task,
      plan_id: plan,
      section_id: section,
      title: "Internal checkout",
      client_title: "Checkout",
    })
    .throwOnError();
  await db
    .from("plan_task_questions")
    .insert({
      task_id: task,
      plan_id: plan,
      body: question,
      client_body: question,
      audience: "client",
      blocking: true,
      asked_by_user_id: admin.user.id,
    })
    .throwOnError();
  await page.goto("/app");
  await page.getByRole("link", { name: new RegExp(question) }).click();
  await page.getByLabel("Your answer: " + question).fill("Ship the new checkout.");
  await page.getByRole("button", { name: "Send answer" }).click();
  await expect(page.getByText("Ship the new checkout.", { exact: true })).toBeVisible();
});
