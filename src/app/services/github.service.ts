import { Injectable } from '@angular/core';
import { HttpClient, HttpErrorResponse, HttpHeaders } from '@angular/common/http';

import { NgxIndexedDB } from 'ngx-indexed-db';

import {
  GithubContent,
  GithubContentFlat
} from './../interfaces/github.interface';
import { Github, GithubFlat } from '../interfaces/github.interface';

import { take } from 'rxjs/operators';

@Injectable({
  providedIn: 'root'
})
export class GithubService {

  private baseUrlApi = 'https://api.github.com';
  private user = 'runelite-extended';
  private repository = 'runelite';

  private db = new NgxIndexedDB('openosrs', 1);

  constructor(private http: HttpClient) {
  }

  private static githubToGithubFlat(commits: Github[]): GithubFlat[] {
    const flatCommits = [];

    for (const commit of commits) {
      flatCommits.push({
        message: commit.commit.message,
        date: commit.commit.committer.date,
        html_url: commit.html_url,
        author_name: commit.commit.author.name,
        author_login: commit.author ? commit.author.login : null,
        author_html_url: commit.author ? commit.author.html_url : null,
        committer_name: commit.commit.committer.name,
        committer_login: commit.committer ? commit.committer.login : null,
        committer_html_url: commit.committer ? commit.committer.html_url : null
      });
    }

    return flatCommits;
  }

  private static githubContentsToName(clients: GithubContent[]): GithubContentFlat[] {
    const flatClients = [];

    for (const client of clients) {
      flatClients.push({
        name: client.name
      });
    }

    return flatClients;
  }

  private async openDatabase(): Promise<any> {
    return this.db.openDatabase(1, evt => {
      const objectStoreGithubModified = evt.currentTarget.result.createObjectStore('github_modified');

      // Last modified
      objectStoreGithubModified.createIndex('update', 'update', { unique: false });

      const objectStoreGithubCommits = evt.currentTarget.result.createObjectStore('github_commits', { keyPath: 'id', autoIncrement: true });

      // Commit
      objectStoreGithubCommits.createIndex('message', 'message', { unique: false });
      objectStoreGithubCommits.createIndex('date', 'date', { unique: false });
      objectStoreGithubCommits.createIndex('html_url', 'html_url', { unique: false });

      // Author
      objectStoreGithubCommits.createIndex('author_name', 'author_name', { unique: false });
      objectStoreGithubCommits.createIndex('author_login', 'author_login', { unique: false });
      objectStoreGithubCommits.createIndex('author_html_url', 'author_html_url', { unique: false });

      // Commiter
      objectStoreGithubCommits.createIndex('commiter_name', 'commiter_name', { unique: false });
      objectStoreGithubCommits.createIndex('commiter_login', 'commiter_login', { unique: false });
      objectStoreGithubCommits.createIndex('commiter_html_url', 'commiter_html_url', { unique: false });
    });
  }

  private async getLastmodified(key: number): Promise<string> {
    return this.db.getByKey('github_modified', key).then(
      (modified) => {
        if (typeof modified === 'undefined') {
          return undefined;
        }

        return modified.update;
      },
      () => {
        return undefined;
      }
    );
  }

  private setLastModified(headers: HttpHeaders, key: number): void {
    if (typeof headers !== 'undefined' && typeof headers.get('Last-Modified') !== 'undefined') {
      this.db.delete('github_modified', key).then(
        () => {
          this.db.add('github_modified', {
            update: headers.get('Last-Modified'),
          }, key);
        }
      );
    }
  }

  private saveCommits(commits: Github[]): void {
    this.db.clear('github_commits').then(
      () => {
        for (const commit of commits) {
          this.db.add('github_commits', {
            message: commit.commit.message,
            date: commit.commit.committer.date,
            html_url: commit.html_url,
            author_name: commit.commit.author.name,
            author_login: commit.author ? commit.author.login : null,
            author_html_url: commit.author ? commit.author.html_url : null,
            committer_name: commit.commit.committer.name,
            committer_login: commit.committer ? commit.committer.login : null,
            committer_html_url: commit.committer ? commit.committer.html_url : null
          });
        }
      }
    );
  }

  private async getSaveditems(objectStore: string): Promise<GithubFlat[] | GithubContentFlat[]> {
    return this.db.getAll(objectStore).then(
      (items) => {
        return items;
      },
      () => {
        return undefined;
      }
    );
  }

  private async fetchCommits(databaseError: boolean): Promise<GithubFlat[]> {
    return new Promise((resolve, reject) => {
      this.http.get<Github[]>(
        `${this.baseUrlApi}/repos/${this.user}/${this.repository}/commits`,
        { observe: 'response' })
        .pipe(
          take(1)
        )
        .subscribe((resp) => {
          if (!databaseError) {
            this.setLastModified(resp.headers, 1);
            this.saveCommits(resp.body);
          }

          resolve(GithubService.githubToGithubFlat(resp.body));
        }, () => reject());
    });
  }

  private async fetchCommitsConditionally(date: string): Promise<GithubFlat[]> {
    return new Promise((resolve, reject) => {
      const httpHeaders = new HttpHeaders({
        'If-Modified-Since': date
      });

      this.http.get<Github[]>(
        `${this.baseUrlApi}/repos/${this.user}/${this.repository}/commits`,
        { observe: 'response', headers: httpHeaders })
        .pipe(
          take(1)
        )
        .subscribe(async (resp) => {
          this.setLastModified(resp.headers, 1);
          this.saveCommits(resp.body);

          resolve(GithubService.githubToGithubFlat(resp.body));
        }, async (error: HttpErrorResponse) => {
          if (error.status === 304) {
            const savedCommits = await this.getSaveditems('github_commits');

            if (typeof savedCommits !== 'undefined') {
              resolve(savedCommits as GithubFlat[]);
            } else {
              this.fetchCommits(false).then(
                (data) => resolve(data)
              ).catch(() => reject());
            }

            reject();
          }

          reject();
        });
    });
  }

  public async getCommits(): Promise<GithubFlat[]> {
    return new Promise(async (resolve, reject) => {
      const databaseError = await this.openDatabase().then(
        () => {
          return false;
        }, () => {
          return true;
        }
      );

      if (!databaseError) {
        const date = await this.getLastmodified(1).then(
          (modifiedDate) => {
            return modifiedDate;
          }
        );

        if (typeof date === 'undefined') {
          this.fetchCommits(false)
            .then((data) => resolve(data))
            .catch(() => reject());
        } else {
          this.fetchCommitsConditionally(date)
            .then((data) => resolve(data))
            .catch(async () => {
              const savedCommits = await this.getSaveditems('github_commits');

              if (typeof savedCommits !== 'undefined') {
                resolve(savedCommits as GithubFlat[]);
              } else {
                reject();
              }
            });
        }
      } else {
        this.fetchCommits(true)
          .then((data) => resolve(data))
          .catch(() => reject());
      }
    });
  }
}
