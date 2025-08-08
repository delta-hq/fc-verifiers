# AWS ECS Terminal-bench Test Plan

## Test Phases

### Phase 1: Infrastructure Deployment
**Goal**: Verify AWS resources are created correctly

```bash
cd aws
./deploy.sh
```

**Verify**:
- [ ] ECS cluster created: `terminal-bench-dev`
- [ ] ECR repository created and Docker image pushed
- [ ] S3 bucket created for results
- [ ] VPC with 2 public subnets
- [ ] Task definition registered
- [ ] Outputs show cluster name, subnet IDs, security group

### Phase 2: Single Task Execution
**Goal**: Verify one terminal-bench task runs in ECS with Docker-in-Docker

```bash
# After updating .env with deploy.sh outputs
python run.py run --tasks hello-world --dry-run  # Check config
python run.py run --tasks hello-world            # Actually run
```

**Verify**:
- [ ] ECS task starts (check AWS Console → ECS → Clusters → Tasks)
- [ ] Task status goes: PROVISIONING → PENDING → RUNNING → STOPPED
- [ ] CloudWatch logs show Docker daemon starting
- [ ] Terminal-bench executes inside container
- [ ] Results saved to S3 bucket
- [ ] Exit code 0 for success

### Phase 3: Parallel Execution (5 Tasks)
**Goal**: Verify parallel orchestration works

```bash
python run.py run --tasks quick --max-parallel 5
# Runs: hello-world, fibonacci, calculator
```

**Verify**:
- [ ] 3 ECS tasks launch simultaneously
- [ ] All tasks visible in ECS console
- [ ] Each task gets unique task ID
- [ ] All complete within ~5 minutes
- [ ] Results for all 3 tasks in S3
- [ ] Summary shows correct pass/fail counts

### Phase 4: Scale Test (10+ Tasks)
**Goal**: Verify system handles larger parallel workloads

```bash
python run.py run --tasks basic,web --max-parallel 10
# Runs ~8 tasks in parallel
```

**Verify**:
- [ ] Up to 10 tasks run concurrently
- [ ] No ECS service limits hit
- [ ] No Docker daemon conflicts
- [ ] All results collected properly
- [ ] Total time < sequential time

### Phase 5: Monitoring & Debugging
**Goal**: Verify we can monitor and debug running tasks

```bash
# While tasks are running:
python run.py status
```

**Verify**:
- [ ] Shows running task count
- [ ] Lists task ARNs
- [ ] CloudWatch logs accessible
- [ ] Can identify failed tasks
- [ ] Can see why tasks failed (logs)

### Phase 6: Cost Validation
**Goal**: Verify costs match expectations

```bash
python run.py costs
# Run 10 tasks for ~30 minutes
```

**Verify**:
- [ ] Actual cost ~$0.38 for 10 tasks/30min
- [ ] No unexpected charges
- [ ] Resources properly tagged for cost tracking

### Phase 7: Cleanup
**Goal**: Verify all resources can be destroyed

```bash
python run.py stop-all  # Stop any running tasks
./cleanup.sh            # Destroy infrastructure
```

**Verify**:
- [ ] All ECS tasks stopped
- [ ] S3 bucket emptied
- [ ] All Terraform resources destroyed
- [ ] No remaining AWS resources
- [ ] No ongoing charges

## Quick Validation Checklist

```bash
# 1. Deploy
cd aws
./setup-local.sh
./deploy.sh

# 2. Configure
vi .env  # Add values from deploy.sh output
aws secretsmanager put-secret-value \
  --secret-id terminal-bench-openai-api-key-dev \
  --secret-string 'sk-xxx'

# 3. Test single task
python run.py run --tasks hello-world

# 4. Test parallel
python run.py run --tasks quick --max-parallel 3

# 5. Check results
aws s3 ls s3://terminal-bench-results-dev-xxx/

# 6. Cleanup
./cleanup.sh
```

## Success Criteria

- ✅ Single task runs successfully in ECS
- ✅ Parallel execution works (3+ concurrent tasks)
- ✅ Docker-in-Docker works inside ECS containers
- ✅ Results saved to S3
- ✅ Can monitor via CloudWatch logs
- ✅ Clean shutdown without resource leaks
- ✅ Costs within estimates ($0.076/hour per task)

## Common Issues to Check

1. **Docker not starting in container**
   - Check CloudWatch logs for "Docker daemon ready"
   - Verify task definition has privileged mode

2. **Tasks failing immediately**
   - Check OpenAI API key in Secrets Manager
   - Verify terminal-bench installed in Docker image

3. **Parallel tasks not running**
   - Check ECS service quotas
   - Verify subnet has enough IPs

4. **High costs**
   - Ensure tasks are stopping properly
   - Check for orphaned ECS tasks

5. **Can't connect to ECS**
   - Verify AWS credentials configured
   - Check IAM permissions