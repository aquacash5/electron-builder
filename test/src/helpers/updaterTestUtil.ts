import { serializeToYaml, TmpDir, executeAppBuilder } from "builder-util"
import { BintrayOptions, GenericServerOptions, GithubOptions, S3Options, SpacesOptions, DownloadOptions } from "builder-util-runtime"
import { AppUpdater, NoOpLogger } from "electron-updater"
import { MacUpdater } from "electron-updater/out/MacUpdater"
import { outputFile } from "fs-extra-p"
import * as path from "path"
import { TestOnlyUpdaterOptions } from "electron-updater/out/AppUpdater"
import { NsisUpdater } from "electron-updater/out/NsisUpdater"
import { TestAppAdapter } from "./TestAppAdapter"
import { assertThat } from "./fileAssert"
import { NodeHttpExecutor } from "builder-util/out/nodeHttpExecutor"

const tmpDir = new TmpDir("updater-test-util")

export async function createTestAppAdapter(version: string = "0.0.1") {
  return new TestAppAdapter(version, await tmpDir.getTempDir())
}

export async function createNsisUpdater(version: string = "0.0.1") {
  const testAppAdapter = await createTestAppAdapter(version)
  const result = new NsisUpdater(null, testAppAdapter)
  await tuneTestUpdater(result)
  return result
}

// to reduce difference in test mode, setFeedURL is not used to set (NsisUpdater also read configOnDisk to load original publisherName)
export async function writeUpdateConfig<T extends GenericServerOptions | GithubOptions | BintrayOptions | S3Options | SpacesOptions>(data: T): Promise<string> {
  const updateConfigPath = path.join(await tmpDir.getTempDir({prefix: "test-update-config"}), "app-update.yml")
  await outputFile(updateConfigPath, serializeToYaml(data))
  return updateConfigPath
}

export async function validateDownload(updater: AppUpdater, expectDownloadPromise = true) {
  const actualEvents = trackEvents(updater)

  const updateCheckResult = await updater.checkForUpdates()
  const assets = (updateCheckResult.updateInfo as any).assets
  if (assets != null) {
    for (const asset of assets) {
      delete asset.download_count
    }
  }

  expect(updateCheckResult.updateInfo).toMatchSnapshot()
  if (expectDownloadPromise) {
    // noinspection JSIgnoredPromiseFromCall
    expect(updateCheckResult.downloadPromise).toBeDefined()
    const downloadResult = await updateCheckResult.downloadPromise
    if (updater instanceof MacUpdater) {
      expect(downloadResult).toEqual([])
    }
    else {
      await assertThat(path.join((downloadResult)!![0])).isFile()
    }
  }
  else {
    // noinspection JSIgnoredPromiseFromCall
    expect(updateCheckResult.downloadPromise).toBeUndefined()
  }

  expect(actualEvents).toMatchSnapshot()
  return updateCheckResult
}

export class TestNodeHttpExecutor extends NodeHttpExecutor {
  download(url: string, destination: string, options: DownloadOptions): Promise<string> {
    const args = ["download", "--url", url, "--output", destination]
    if (options != null && options.sha512) {
      args.push("--sha512", options.sha512)
    }
    return executeAppBuilder(args)
      .then(() => destination)
  }
}

export const httpExecutor: TestNodeHttpExecutor = new TestNodeHttpExecutor()

export async function tuneTestUpdater(updater: AppUpdater, options?: TestOnlyUpdaterOptions) {
  (updater as any).httpExecutor = httpExecutor;
  (updater as any)._testOnlyOptions = {
    platform: "win32",
    ...options,
  }
  updater.logger = new NoOpLogger()
}

export function trackEvents(updater: AppUpdater) {
  const actualEvents: Array<string> = []
  for (const eventName of ["checking-for-update", "update-available", "update-downloaded", "error"]) {
    updater.addListener(eventName, () => {
      actualEvents.push(eventName)
    })
  }
  return actualEvents
}