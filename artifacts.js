import path from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';

export function createJobArtifacts({ artifactRoot, jobId }) {
  const directory = path.posix.join('jobs', jobId);
  return {
    root: artifactRoot,
    directory,
    absoluteDirectory: path.join(artifactRoot, directory),
    relative: {
      directory,
      request: path.posix.join(directory, 'request.json'),
      response: path.posix.join(directory, 'response.json'),
      screenshot: path.posix.join(directory, 'screenshot.png'),
      html: path.posix.join(directory, 'page.html'),
      text: path.posix.join(directory, 'text.txt'),
      ariaSnapshotPath: path.posix.join(directory, 'aria.yaml'),
      trace: path.posix.join(directory, 'trace.zip'),
      downloads: path.posix.join(directory, 'downloads')
    },
    absolute: {
      request: path.join(artifactRoot, directory, 'request.json'),
      response: path.join(artifactRoot, directory, 'response.json'),
      screenshot: path.join(artifactRoot, directory, 'screenshot.png'),
      html: path.join(artifactRoot, directory, 'page.html'),
      text: path.join(artifactRoot, directory, 'text.txt'),
      downloads: path.join(artifactRoot, directory, 'downloads')
    }
  };
}

export async function prepareJobArtifacts(jobArtifacts) {
  await mkdir(jobArtifacts.absoluteDirectory, { recursive: true });
  await mkdir(jobArtifacts.absolute.downloads, { recursive: true });
}

export async function writeJsonFile(filePath, value) {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}