import streamlit as st
import pandas as pd
from app.database.core import engine
from run_social_scraper import run_scraper

st.set_page_config(page_title="Outreach Scraper", page_icon="✉️", layout="wide")

st.title("Outreach Campaign Dashboard ✉️")
st.markdown("Monitor your Postgres cloud database and configure targeted scraping runs.")

# Sidebar Configuration
st.sidebar.header("Scraper Settings")

platforms = st.sidebar.multiselect(
    "Target Platforms",
    ["instagram", "tiktok", "youtube"],
    default=["instagram", "tiktok"]
)

st.sidebar.markdown("---")
min_f = st.sidebar.number_input("Minimum Followers", value=10000, step=1000)
max_f = st.sidebar.number_input("Maximum Followers", value=100000, step=10000)

st.sidebar.markdown("---")
st.sidebar.markdown("**Search Niches (One per line)**")
niches = st.sidebar.text_area("Niches", value="family vlog\ngift ideas\nmom blogger")

# Construct Queries
def build_queries(niches_text, selected_platforms):
    queries = []
    lines = [n.strip() for n in niches_text.split('\n') if n.strip()]
    for line in lines:
        for p in selected_platforms:
            q = f"{line} {p} business email"
            queries.append((q, p))
    return queries

if st.sidebar.button("🚀 Run Scraper Now", type="primary"):
    queries = build_queries(niches, platforms)
    st.info(f"Running scraper with {len(queries)} queries for followers between {min_f} and {max_f}...")
    
    with st.spinner("Scraping YouTube cross-posts..."):
        results = run_scraper(queries, min_followers=min_f, max_followers=max_f, max_results=15)
        
    st.success(f"Scraper finished! Found {len(results)} new emails and synced to Postgres.")

st.markdown("### Cloud Database (PostgreSQL)")

# Load data directly from PostgreSQL using pandas
@st.cache_data(ttl=10) # Refresh every 10 seconds if queried
def load_data():
    try:
        query = """
        SELECT 
            e.address, 
            c.name as creator_name, 
            c.platform as creator_platform, 
            e.is_valid,
            CASE WHEN el.id IS NOT NULL THEN 'Yes' ELSE 'No' END as emailed
        FROM emails e
        JOIN creators c ON e.creator_id = c.id
        LEFT JOIN email_logs el ON e.id = el.email_id AND el.status = 'sent'
        ORDER BY e.created_at DESC
        """
        df = pd.read_sql(query, engine)
        return df
    except Exception as e:
        st.error(f"Failed to connect to database: {e}")
        return pd.DataFrame()

df = load_data()

if not df.empty:
    st.dataframe(
        df,
        use_container_width=True,
        hide_index=True
    )
    
    # Download Button
    csv = df.to_csv(index=False).encode('utf-8')
    st.download_button(
        label="📥 Download CSV",
        data=csv,
        file_name='outreach_emails_db.csv',
        mime='text/csv',
    )
else:
    st.warning("No emails collected yet in the Postgres database. Run the scraper to populate data.")
