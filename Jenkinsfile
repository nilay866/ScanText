pipeline {
    agent any

    stages {

        stage('Clone') {
            steps {
                echo "Code already checked out by Jenkins"
            }
        }

        stage('Build') {
            steps {
                echo "Building application..."
            }
        }

        stage('Test') {
            steps {
                echo "Running tests..."
            }
        }

        stage('Docker Build') {
            steps {
                sh 'docker build -t scantext-app .'
            }
        }

        stage('Deploy') {
            steps {
                sh 'docker stop scantext-app || true'
                sh 'docker rm scantext-app || true'
                sh 'docker run -d --name scantext-app -p 8081:80 scantext-app'
            }
        }
    }
}
