# Storage Tier Configuration Guide

## Overview
StackMemory uses a 3-tier storage system for optimal performance and cost:
- **Hot Tier (Redis)**: Last 24 hours - Already configured ✅
- **Warm Tier (Railway Buckets)**: 1-30 days - Setup required
- **Cold Tier (GCS)**: 30+ days - Setup required

## 1. Railway Buckets Setup (Warm Tier)

### Option A: Using Railway CLI

```bash
# Install Railway CLI if not already installed
brew install railway

# Login to Railway
railway login

# Create a new bucket
railway storage create stackmemory-warm

# Get bucket credentials
railway storage credentials stackmemory-warm
```

### Option B: Using Railway Dashboard

1. Go to [Railway Dashboard](https://railway.app)
2. Navigate to your project
3. Click "New" → "Bucket"
4. Name it `stackmemory-warm`
5. Copy the credentials:
   - Endpoint URL
   - Access Key ID
   - Secret Access Key

### Add to .env file:

```bash
# Railway Bucket Configuration
RAILWAY_BUCKET_ENDPOINT=https://buckets.railway.app
RAILWAY_BUCKET_NAME=stackmemory-warm
RAILWAY_BUCKET_ACCESS_KEY=your_access_key_here
RAILWAY_BUCKET_SECRET_KEY=your_secret_key_here
```

## 2. Google Cloud Storage Setup (Cold Tier)

### Step 1: Create GCS Bucket

```bash
# Install gcloud CLI if not already installed
brew install google-cloud-sdk

# Authenticate
gcloud auth login

# Set your project
gcloud config set project YOUR_PROJECT_ID

# Create a Coldline bucket for cost optimization
gsutil mb -c coldline -l us-central1 gs://stackmemory-cold

# Verify bucket creation
gsutil ls
```

### Step 2: Create Service Account

```bash
# Create service account
gcloud iam service-accounts create stackmemory-storage \
  --display-name="StackMemory Storage Service"

# Get service account email
SERVICE_ACCOUNT=stackmemory-storage@YOUR_PROJECT_ID.iam.gserviceaccount.com

# Grant bucket permissions
gsutil iam ch serviceAccount:$SERVICE_ACCOUNT:objectAdmin gs://stackmemory-cold

# Create and download key file
gcloud iam service-accounts keys create \
  ~/.stackmemory/gcs-key.json \
  --iam-account=$SERVICE_ACCOUNT

echo "Key saved to ~/.stackmemory/gcs-key.json"
```

### Step 3: Add to .env file:

```bash
# GCS Configuration
GCS_BUCKET=stackmemory-cold
GCP_PROJECT_ID=your-project-id
GCP_KEY_FILE=/Users/jwu/.stackmemory/gcs-key.json
```

## 3. Alternative: Use AWS S3 Instead

If you prefer AWS S3 over Railway Buckets:

```bash
# Create S3 bucket with lifecycle rules
aws s3 mb s3://stackmemory-storage --region us-east-1

# Create lifecycle policy for automatic archival
cat > lifecycle.json << 'EOF'
{
  "Rules": [
    {
      "Id": "ArchiveOldTraces",
      "Status": "Enabled",
      "Transitions": [
        {
          "Days": 30,
          "StorageClass": "GLACIER_IR"
        },
        {
          "Days": 90,
          "StorageClass": "DEEP_ARCHIVE"
        }
      ]
    }
  ]
}
EOF

aws s3api put-bucket-lifecycle-configuration \
  --bucket stackmemory-storage \
  --lifecycle-configuration file://lifecycle.json
```

Add to .env:
```bash
# S3 Configuration (alternative to Railway)
S3_BUCKET=stackmemory-storage
AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=your_access_key
AWS_SECRET_ACCESS_KEY=your_secret_key
```

## 4. Testing Your Configuration

After setting up, test with:

```bash
# Test storage status
stackmemory storage status

# Test migration (dry run first)
stackmemory storage migrate --dry-run

# Perform actual migration
stackmemory storage migrate

# Verify trace retrieval
stackmemory storage retrieve <trace-id>
```

## 5. Cost Estimates

| Tier | Storage Type | Cost/GB/Month | Access Cost |
|------|-------------|---------------|-------------|
| Hot | Redis (Railway) | $0.00 (included) | Free |
| Warm | Railway Buckets | ~$0.023 | $0.01/1000 requests |
| Warm | AWS S3 Standard | $0.023 | $0.0004/1000 requests |
| Cold | GCS Coldline | $0.004 | $0.01/GB retrieval |
| Cold | AWS Glacier IR | $0.004 | $0.03/GB retrieval |

## 6. Troubleshooting

### Railway Buckets Connection Issues
```bash
# Test connection
curl -I https://buckets.railway.app

# Verify credentials
railway whoami
railway project
```

### GCS Permission Issues
```bash
# Check service account permissions
gcloud projects get-iam-policy YOUR_PROJECT_ID \
  --flatten="bindings[].members" \
  --filter="bindings.members:stackmemory-storage"

# Test bucket access
gsutil ls gs://stackmemory-cold
```

### Redis Connection Issues
```bash
# Test Redis connection
redis-cli -u $REDIS_URL ping
```

## Next Steps

1. Choose your preferred warm tier (Railway Buckets or AWS S3)
2. Set up GCS for cold storage
3. Add credentials to .env file
4. Test with `stackmemory storage status`
5. Monitor costs with `stackmemory storage stats`