# AWS Guard rules used by the Mireli VM check

`cis-aws-benchmark-level-1.guard` is copied from the AWS CloudFormation Guard
Rules Registry release `1.0.2`:

- Upstream: https://github.com/aws-cloudformation/aws-guard-rules-registry
- Upstream release: https://github.com/aws-cloudformation/aws-guard-rules-registry/releases/tag/1.0.2
- Managed rule set: `cis-aws-benchmark-level-1`
- License: Apache-2.0, as declared by the upstream repository.

The VM template suppresses `S3_BUCKET_LOGGING_ENABLED` only for the database
backup bucket. A second bucket solely for server access logs is intentionally
deferred during the credit-limited pilot. This leaves object-level S3 access
logs unavailable; the production cutover checklist must add S3 data-event audit
coverage or a separate server-access-log destination.
