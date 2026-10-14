"""Vocabulary of common skills, used to find skills mentioned anywhere in a resume (not only in a Skills section)."""

SKILLS = [
    # languages
    # Single letters ("C", "R") and "Go" are left out: too ambiguous to scan for. The model still keeps them
    # when they are listed in the resume's skills section.
    "Python", "Java", "JavaScript", "TypeScript", "C++", "C#", "Golang", "Rust", "Kotlin", "Swift",
    "Dart", "Ruby", "PHP", "Scala", "MATLAB", "SQL", "Bash", "Shell", "Solidity", "Elixir", "Haskell",
    # web
    "HTML", "CSS", "React", "React Native", "Next.js", "Vue", "Angular", "Svelte", "Node.js", "Express",
    "Django", "Flask", "FastAPI", "Spring", "Spring Boot", "Rails", "Laravel", ".NET", "GraphQL", "REST",
    "Tailwind", "Redux", "jQuery", "Bootstrap", "Webpack", "Vite", "Flutter", "Android", "iOS", "SwiftUI",
    # data / ml
    "Machine Learning", "Deep Learning", "NLP", "Computer Vision", "LLM", "Generative AI", "PyTorch",
    "TensorFlow", "Keras", "scikit-learn", "Pandas", "NumPy", "Matplotlib", "Seaborn", "OpenCV", "Hugging Face",
    "LangChain", "Spark", "PySpark", "Hadoop", "Airflow", "dbt", "Kafka", "Snowflake", "BigQuery", "Databricks",
    "Tableau", "Power BI", "Looker", "Excel", "Statistics", "Data Analysis", "Data Visualization", "ETL",
    "A/B Testing", "Jupyter",
    # infra
    "AWS", "GCP", "Google Cloud", "Azure", "Docker", "Kubernetes", "Terraform", "Ansible", "Jenkins",
    "GitHub Actions", "CI/CD", "Linux", "Nginx", "Git", "Microservices", "Serverless", "Firebase", "Supabase",
    "Vercel", "Prometheus", "Grafana",
    # databases
    "PostgreSQL", "MySQL", "MongoDB", "Redis", "SQLite", "DynamoDB", "Cassandra", "Elasticsearch", "Oracle",
    # design / product
    "Figma", "Adobe XD", "Photoshop", "Illustrator", "After Effects", "Premiere Pro", "Canva", "Blender",
    "UI/UX", "UX Research", "Wireframing", "Prototyping", "Product Management", "Agile", "Scrum", "Jira",
    # business
    "Digital Marketing", "SEO", "SEM", "Content Writing", "Copywriting", "Social Media", "Google Analytics",
    "Salesforce", "HubSpot", "CRM", "Sales", "Business Development", "Market Research", "Financial Modeling",
    "Accounting", "Tally", "Communication", "Leadership", "Public Speaking",
    # cs / security / testing
    "Data Structures", "Algorithms", "System Design", "OOP", "DBMS", "Operating Systems", "Computer Networks",
    "Cybersecurity", "Penetration Testing", "Selenium", "Cypress", "Jest", "Pytest", "Postman", "Unity",
    "Unreal Engine", "Embedded Systems", "Arduino", "Raspberry Pi", "IoT", "Blockchain", "Web3",
]
