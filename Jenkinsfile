pipeline {
    agent any

    stages {

        stage('Clone') {
            steps {
                echo "Repository already cloned by Jenkins"
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
                script {
                    docker.build("scantext-app")
                }
            }
        }

        stage('Deploy') {
            steps {
                sh 'docker run -d -p 8081:80 scantext-app'
            }
        }
    }
}
