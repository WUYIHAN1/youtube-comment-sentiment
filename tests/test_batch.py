import unittest
from unittest.mock import Mock, patch

from fastapi.testclient import TestClient
from backend import main
from backend.youtube import list_recent_videos, YouTubeError
from backend.llm import screen_ad_videos, LLMError


class BatchTests(unittest.TestCase):
    def test_channel_handle_uploads_and_order(self):
        yt = Mock()
        yt.videos.return_value.list.return_value.execute.return_value = {"items": [{"id":"12345678901","statistics":{"viewCount":"1234","likeCount":"0"}}]}
        yt.channels.return_value.list.return_value.execute.return_value = {
            "items": [{"snippet": {"title": "Creator"}, "contentDetails": {"relatedPlaylists": {"uploads": "UU123"}}}]}
        yt.playlistItems.return_value.list.return_value.execute.return_value = {"items": [
            {"snippet": {"title": "Older", "description": "text"}, "contentDetails": {"videoId": "abcdefghijk", "videoPublishedAt": "2026-01-01"}},
            {"snippet": {"title": "Newer"}, "contentDetails": {"videoId": "12345678901", "videoPublishedAt": "2026-02-01"}}]}
        with patch('backend.youtube.build_client', return_value=yt), patch('backend.youtube.quota.add_usage'):
            result = list_recent_videos('key', 'https://www.youtube.com/@test/videos', 10)
        self.assertEqual(result['videos'][0]['title'], 'Newer')
        self.assertEqual(result['videos'][0]['view_count'],1234)
        self.assertEqual(result['videos'][0]['like_count'],0)
        self.assertIsNone(result['videos'][1]['like_count'])
        yt.channels.return_value.list.assert_called_once_with(part='snippet,contentDetails', forHandle='@test')
        self.assertEqual(yt.playlistItems.return_value.list.call_args.kwargs['playlistId'], 'UU123')

    def test_invalid_channel_never_calls_api(self):
        with patch('backend.youtube.build_client') as build:
            with self.assertRaises(YouTubeError):
                list_recent_videos('key', 'https://evil.example/@test')
            build.assert_not_called()

    def test_ad_evidence_must_exist(self):
        data = {'videos': [{'id': 'abcdefghijk', 'status': 'suspected', 'reason': 'Sponsor', 'evidence': 'invented'}]}
        with patch('backend.llm._get_client'), patch('backend.llm._chat_json', return_value=data):
            result = screen_ad_videos([{'id':'abcdefghijk','title':'Review','description':'ordinary review'}])
        self.assertEqual(result[0]['status'], 'unknown')
        self.assertEqual(result[0]['evidence'], '')

    def test_duplicate_ad_ids_rejected(self):
        item = {'id':'abcdefghijk','status':'unknown','reason':'','evidence':''}
        with patch('backend.llm._get_client'), patch('backend.llm._chat_json', return_value={'videos':[item,item]}):
            with self.assertRaises(LLMError):
                screen_ad_videos([{'id':'abcdefghijk','title':'A','description':''}, {'id':'12345678901','title':'B','description':''}])

    def test_topic_only_endpoint_does_not_reclassify(self):
        topics = {'summary':'Summary','themes':[],'needs':[]}
        with patch.object(main.budget, 'check_ip_limit', return_value=True), patch.object(main.budget, 'check_daily_cap', return_value=True), patch.object(main, 'summarize_topics', return_value=topics), patch.object(main, 'reclassify_comments') as review:
            response = TestClient(main.app).post('/api/batch-topics',json={'video_title':'Video','comments':[{'id':'c','text':'A','confidence':0.1}]})
        self.assertEqual(response.status_code,200)
        review.assert_not_called()

    def test_bounds_and_rate_limit(self):
        client = TestClient(main.app)
        self.assertEqual(client.post('/api/channel-videos',json={'channel':'@test','limit':51}).status_code,422)
        with patch.object(main, 'API_KEY', 'key'), patch.object(main.budget,'check_ip_limit',return_value=False), patch.object(main,'analyze_video') as analyze:
            response=client.post('/api/batch-item',json={'url':'abcdefghijk'})
        self.assertEqual(response.status_code,429)
        analyze.assert_not_called()


if __name__ == '__main__':
    unittest.main()
